"""Test the authored Tab Pocket fixture in a fresh Firefox WebDriver profile."""
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request

root = Path(__file__).resolve().parent.parent
artifact = root / "artifacts" / "firefox"
artifact.mkdir(parents=True, exist_ok=True)
driver = os.environ.get("BRIDGEFOX_GECKODRIVER") or shutil.which("geckodriver")
binary = os.environ.get("BRIDGEFOX_FIREFOX_BINARY") or shutil.which("firefox")
if not driver or not binary:
    raise SystemExit("Set BRIDGEFOX_GECKODRIVER and BRIDGEFOX_FIREFOX_BINARY to your Firefox test tools.")
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
log = (artifact / "webdriver.log").open("w")
process = subprocess.Popen([driver, "--port", str(port), "--host", "127.0.0.1", "--log", "warn", "--allow-system-access"], stdout=log, stderr=log)
endpoint = f"http://127.0.0.1:{port}"
session_id = None

def request(path, payload=None, method=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(endpoint + path, data=data, headers={"Content-Type": "application/json"}, method=method or ("GET" if payload is None else "POST"))
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.load(response)["value"]
    except urllib.error.HTTPError as error:
        result = json.load(error)["value"]
        raise RuntimeError(f"WebDriver {result.get('error')}: {result.get('message')}") from None
    return result

def session(path, payload=None, method=None):
    return request(f"/session/{session_id}" + path, payload, method)

def script(text, args=None, asynchronous=False):
    return session("/execute/async" if asynchronous else "/execute/sync", {"script": text, "args": args or []})

try:
    deadline = time.monotonic() + 15
    while True:
        try:
            request("/status")
            break
        except (urllib.error.URLError, ConnectionError):
            if time.monotonic() > deadline or process.poll() is not None:
                raise RuntimeError("Firefox WebDriver did not start") from None
            time.sleep(.1)
    manifest = json.loads((root / "fixtures/tab-pocket/manifest.json").read_text())
    addon_id = manifest["browser_specific_settings"]["gecko"]["id"]
    uuid = "68526cf0-6fde-441f-b9b4-caa1857d9051"
    created = request("/session", {"capabilities": {"alwaysMatch": {"browserName": "firefox", "moz:firefoxOptions": {"binary": binary, "args": ["-headless"], "prefs": {"extensions.webextensions.uuids": json.dumps({addon_id: uuid})}}}}})
    session_id = created["sessionId"]
    session("/timeouts", {"script": 10000, "pageLoad": 20000, "implicit": 0})
    installed = session("/moz/addon/install", {"path": str(root / "artifacts/tab-pocket-firefox.zip"), "temporary": True})
    assert installed == addon_id
    print("PASS exported ZIP installed in Firefox", flush=True)
    target_url = (os.environ.get("BRIDGEFOX_TEST_URL") or "http://localhost:3035") + "/examples/tab-page.html"
    session("/url", {"url": target_url})
    target_window = session("/window")
    # Model the same activeTab grant Firefox supplies on a toolbar activation.
    # This runs only in this fresh test profile; no manifest permission is added.
    session("/moz/context", {"context": "chrome"})
    script('const {ExtensionParent}=ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs"); const extension=ExtensionParent.GlobalManager.extensionMap.get(arguments[0]); const win=Services.wm.getMostRecentWindow("navigator:browser"); extension.tabManager.addActiveTabPermission(win.gBrowser.selectedTab); return true;', [addon_id])
    session("/moz/context", {"context": "content"})
    popup_window = session("/window/new", {"type": "tab"})["handle"]
    session("/window", {"handle": popup_window})
    session("/url", {"url": f"moz-extension://{uuid}/popup.html"})
    assert script("return document.querySelector('h1').textContent") == "Tab Pocket"
    print("PASS real Firefox popup loaded", flush=True)
    tabs = script("const done=arguments[0]; chrome.tabs.query({},done);", asynchronous=True)
    target_tab = next(tab for tab in tabs if tab.get("url") == target_url)
    script("const id=arguments[0], done=arguments[1]; chrome.tabs.update(id,{active:true},()=>{document.querySelector('#save').click();done(true);});", [target_tab["id"]], asynchronous=True)
    deadline = time.monotonic() + 10
    while script("return document.querySelector('#status').textContent") != "Saved to your pocket.":
        if time.monotonic() > deadline:
            raise AssertionError("The popup did not save the target tab")
        time.sleep(.1)
    stored = script("const done=arguments[0];chrome.storage.local.get({savedTabs:[]},done);", asynchronous=True)
    assert len(stored["savedTabs"]) == 1 and stored["savedTabs"][0]["url"] == target_url
    session("/refresh", {})
    deadline = time.monotonic() + 10
    while not script("return !!document.querySelector('#tabs a')"):
        if time.monotonic() > deadline:
            raise AssertionError("Saved tabs did not survive a popup reload")
        time.sleep(.1)
    assert script("return document.querySelector('#tabs a').href") == target_url
    (artifact / "tab-pocket.png").write_bytes(base64.b64decode(session("/screenshot")))
    handles_before = set(session("/window/handles"))
    script("document.querySelector('#tabs a').click();")
    deadline = time.monotonic() + 10
    while True:
        new_handles = set(session("/window/handles")) - handles_before
        if new_handles:
            break
        if time.monotonic() > deadline:
            raise AssertionError("The saved link did not reopen a tab")
        time.sleep(.1)
    session("/window", {"handle": next(iter(new_handles))})
    deadline = time.monotonic() + 10
    while session("/url") != target_url:
        if time.monotonic() > deadline:
            raise AssertionError("The reopened tab did not navigate to the saved URL")
        time.sleep(.1)
    evidence = {"testedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "firefox": created["capabilities"]["browserVersion"], "driver": "Mozilla geckodriver", "addonId": addon_id, "installedExportedZip": True, "activeTabGrant": "Native Firefox permission grant simulating a toolbar activation in the fresh test profile", "savedRealFirefoxTab": True, "storageSurvivedPopupReload": True, "reopenedSavedTab": True, "liveOtariCalls": 0, "scope": "Authored Tab Pocket fixture in a temporary Firefox profile; not a universal compatibility proof or participant video."}
    (artifact / "checks.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))
finally:
    if session_id:
        try:
            session("", method="DELETE")
        except Exception:
            pass
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    log.close()
