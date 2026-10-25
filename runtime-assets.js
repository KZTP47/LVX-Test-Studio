window.LVXAssetPaths={monaco:new URL('assets/vendor/monaco/vs',location.href).href,pyodide:new URL('assets/vendor/pyodide/',location.href).href};
let pythonQueue=Promise.resolve();
window.withPythonRuntime=task=>{const run=pythonQueue.then(task);pythonQueue=run.catch(()=>{});return run;};
let firebasePromise;
window.loadFirebaseModules=()=>firebasePromise ||= Promise.all([
 import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'),
 import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'),
 import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js')
]).then(modules=>window.firebaseModules=Object.assign({},...modules)).catch(error=>{firebasePromise=null;throw error;});
