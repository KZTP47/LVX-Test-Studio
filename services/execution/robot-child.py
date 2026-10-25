"""Native Robot runner: code/config/results/XML remain in memory."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import traceback
import types
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

config = json.loads(sys.stdin.read())
channel = sys.stdout
def send(message):
    channel.write(json.dumps(message, ensure_ascii=False) + "\n")
    channel.flush()
class Output:
    encoding = "utf-8"
    def __init__(self, kind): self.kind = kind
    def write(self, value):
        if value: send({"type": self.kind, "text": str(value)})
        return len(value)
    def flush(self): channel.flush()
    def isatty(self): return False
class MemoryXml(io.StringIO):
    # Robot owns/close()s its output writer. Retain the in-memory bytes so the
    # native XML can be parsed and passed to the parent without a temp file.
    def close(self): pass

result = {"status": "ERROR", "total": 0, "passed": 0, "failed": 0, "errors": 1, "pending": 0, "artifacts": {}}
work = Path(sys.argv[1]).resolve() / "files"
work.mkdir()
sys.path.insert(0, str(work))
sys.path.insert(1, str(Path.cwd()))
try:
    from robot.api import TestSuite
    from robot.api.deco import keyword, library
    @library(scope="GLOBAL", auto_keywords=False)
    class BrowserLibrary:
        ROBOT_LIBRARY_VERSION = "2.0.0"
        def _call(self, name, *args):
            data = json.dumps({"name": name, "args": list(args)}).encode("utf-8")
            request = urllib.request.Request(config["driver"]["endpoint"], data=data, headers={"Content-Type": "application/json", "Authorization": "Bearer " + config["driver"]["token"]})
            try:
                with urllib.request.urlopen(request, timeout=65) as response: value = json.load(response)
            except urllib.error.HTTPError as error:
                raise AssertionError(json.load(error).get("error", "Browser keyword failed")) from None
            return value.get("value")
        @keyword("Click Element")
        def click(self, selector): return self._call("Click Element", selector)
        @keyword("Input Text")
        def input(self, selector, text): return self._call("Input Text", selector, str(text))
        @keyword("Element Should Contain")
        def contains(self, selector, text): return self._call("Element Should Contain", selector, str(text))
        @keyword("Element Should Be Visible")
        def visible(self, selector): return self._call("Element Should Be Visible", selector)
        @keyword("Element Should Exist")
        def exists(self, selector): return self._call("Element Should Exist", selector)
        @keyword("Page Should Contain")
        def page_contains(self, text): return self._call("Page Should Contain", str(text))
        @keyword("Wait For Element")
        def wait(self, selector, timeout=5): return self._call("Wait For Element", selector, float(timeout))
        @keyword("Wait Until Element Is Visible")
        def wait_visible(self, selector, timeout=5): return self._call("Wait Until Element Is Visible", selector, float(timeout))
        @keyword("Get Text")
        def get_text(self, selector): return self._call("Get Text", selector)
        @keyword("Get Value")
        def get_value(self, selector): return self._call("Get Value", selector)
        @keyword("Open Browser")
        def open(self, url="about:blank", browser="chromium"): return self._call("Open Browser", url, browser)
        @keyword("Go To")
        def goto(self, url): return self._call("Go To", url)
        @keyword("Close Browser")
        def close(self): return self._call("Close Browser")
        @keyword("Select From List")
        def select(self, selector, value): return self._call("Select From List", selector, str(value))
        @keyword("Check Checkbox")
        def check(self, selector): return self._call("Check Checkbox", selector)
        @keyword("Uncheck Checkbox")
        def uncheck(self, selector): return self._call("Uncheck Checkbox", selector)
    module = types.ModuleType("BrowserLibrary")
    module.BrowserLibrary = BrowserLibrary
    sys.modules["BrowserLibrary"] = module
    os.chdir(work)
    for item in config.get("inputFiles") or []:
        target = (work / item["filename"]).resolve()
        if not target.is_relative_to(work): raise ValueError("Input file must stay inside the suite directory")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(item.get("content", "")), encoding="utf-8")
    with contextlib.redirect_stdout(Output("stdout")), contextlib.redirect_stderr(Output("stderr")):
        old_stdout, old_stderr = sys.__stdout__, sys.__stderr__
        sys.__stdout__, sys.__stderr__ = Output("stdout"), Output("stderr")
        suite = TestSuite.from_string(config.get("code") or "").config(name="LVX authored Robot suite")
        variables = types.ModuleType("LvxRuntimeVariables")
        variables.get_variables = lambda: {"parameters": config.get("parameters") or {}, **(config.get("parameters") or {})}
        sys.modules["LvxRuntimeVariables"] = variables
        suite.resource.imports.variables("LvxRuntimeVariables")
        try:
            native = suite.run(output=None, log=None, report=None, stdout=Output("stdout"), stderr=Output("stderr"), console="none")
            xml = MemoryXml()
            native.save(xml)
        finally:
            sys.__stdout__, sys.__stderr__ = old_stdout, old_stderr
    root = ET.fromstring(xml.getvalue())
    cases = []
    for case in root.findall(".//test"):
        status = case.find("status")
        state = status.get("status", "FAIL") if status is not None else "FAIL"
        cases.append({"name": case.get("name"), "status": "SUCCESS" if state == "PASS" else "PENDING" if state in ("SKIP", "NOT RUN") else "FAILURE", "message": status.text if status is not None else "Missing Robot status"})
    total = len(cases)
    passed = sum(case["status"] == "SUCCESS" for case in cases)
    failed = sum(case["status"] == "FAILURE" for case in cases)
    pending = sum(case["status"] == "PENDING" for case in cases)
    errors = sum(message.get("level") in ("ERROR", "FAIL") for message in root.findall("./errors/msg"))
    result = {"status": "ERROR" if not total or errors or pending else "FAILURE" if failed else "SUCCESS", "total": total, "passed": passed, "failed": failed, "errors": errors + int(not total), "pending": pending, "cases": cases, "artifacts": {"robotOutputXml": xml.getvalue()}}
except BaseException:
    result["error"] = traceback.format_exc()
    send({"type": "stderr", "text": result["error"]})
finally:
    send({"type": "result", "result": result})
sys.exit(0 if result["status"] == "SUCCESS" else 1)
