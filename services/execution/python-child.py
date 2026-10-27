"""Native Python execution protocol. Parent owns the temporary directory."""
import json
import contextlib
import os
from pathlib import Path
import sys
import traceback

config = json.loads(sys.stdin.read())
channel = sys.stdout
captured = {"stdout": [], "stderr": []}
captured_size = 0
validation_started = False
def send(message):
    channel.write(json.dumps(message, ensure_ascii=False) + "\n")
    channel.flush()
class Output:
    encoding = "utf-8"
    def __init__(self, kind): self.kind = kind
    def write(self, value):
        global captured_size
        if value:
            if config.get("validationCode"):
                captured_size += len(str(value))

                captured[self.kind].append(str(value))
            send({"type": self.kind, "text": str(value)})
        return len(value)
    def flush(self): channel.flush()
    def isatty(self): return False
work = Path(sys.argv[1]).resolve() / "files"
work.mkdir()
sys.path.insert(0, str(work))
old_cwd = Path.cwd()
namespace = dict(config.get("contextVariables") or {})
namespace.update(__name__="__main__", parameters=config.get("parameters") or {}, inputs=config.get("inputs") or {}, fixture={})
result = {"status": "SUCCESS", "total": 1, "passed": 1, "failed": 0, "errors": 0, "artifacts": {}}
try:
    os.chdir(work)
    for item in config.get("inputFiles") or []:
        target = (work / item["filename"]).resolve()
        if not target.is_relative_to(work):
            raise ValueError("Input file must stay within the suite directory")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(item.get("content", "")), encoding="utf-8")
    with contextlib.redirect_stdout(Output("stdout")), contextlib.redirect_stderr(Output("stderr")):
        try:
            exec(compile(config.get("setup") or "", "<lvx-setup>", "exec"), namespace)
            exec(compile(config.get("code") or "", "<lvx-test>", "exec"), namespace)
        finally:
            exec(compile(config.get("cleanup") or "", "<lvx-cleanup>", "exec"), namespace)
        if config.get("validationCode"):
            validation_started = True
            stdout_value = "".join(captured["stdout"])
            stderr_value = "".join(captured["stderr"])
            test_output = stdout_value + stderr_value
            def assert_output_equals(expected):
                actual = str(namespace.get("TEST_OUTPUT", "")).replace("\r\n", "\n").replace("\r", "\n").rstrip()
                expected_value = str(expected).replace("\r\n", "\n").replace("\r", "\n").rstrip()
                if actual != expected_value:
                    raise AssertionError(f"Expected output {expected_value!r}, got {actual!r}")
            namespace.update(TEST_OUTPUT=test_output, TEST_STDOUT=stdout_value,
                             TEST_STDERR=stderr_value, assert_output_equals=assert_output_equals)
            namespace.setdefault("ARTIFACTS", {})
            result["total"] += 1
            exec(compile(config["validationCode"], "<lvx-validation>", "exec"), namespace)
            result["passed"] += 1
except BaseException as error:
    result.update(status="FAILURE" if isinstance(error, AssertionError) else "ERROR", passed=1 if validation_started else 0, failed=int(isinstance(error, AssertionError)), errors=int(not isinstance(error, AssertionError)), error=traceback.format_exc())
    send({"type": "stderr", "text": result["error"]})
finally:
    os.chdir(old_cwd)
    try:
        result["artifacts"] = namespace.get("ARTIFACTS", {})
        json.dumps(result["artifacts"])
    except BaseException:
        result.update(status="ERROR", passed=0, errors=result.get("errors", 0)+1, artifacts={}, error="Python artifacts must be JSON serializable.")
    send({"type": "result", "result": result})
sys.exit(0 if result["status"] == "SUCCESS" else 1)
