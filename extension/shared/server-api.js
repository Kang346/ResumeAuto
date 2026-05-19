// Centralized fetch wrappers for the local server. All endpoints in one
// place so popup and panel share the same contract; whoever changes the
// server only updates this file.

export const SERVER = "http://127.0.0.1:8765";

async function getJson(path) {
  const r = await fetch(`${SERVER}${path}`);
  return r.json();
}

async function postJson(path, body) {
  const r = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

export const api = {
  getStatus:        () => getJson("/status"),
  getState:         () => getJson("/state"),
  getPdfList:       () => getJson("/pdf-list"),
  getPendingJobs:   () => getJson("/pending-jobs"),
  getPendingAnswers:() => getJson("/pending-answers"),
  saveJob:          ({ url, title }) => postJson("/save-job", { url, title: title || "" }),
  consumeAnswer:    (id) => postJson("/consume-answer", { id }),
};
