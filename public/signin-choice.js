// Upgrades the masthead "Sign in" link into a chooser, because there are two apps behind
// this one domain now.
//
// PROGRESSIVE ENHANCEMENT ON PURPOSE. The link in site.html is a real href to the family
// app's sign-in, exactly what it was before this file existed. If this script is blocked,
// fails to parse, or runs in a browser without <dialog>, clicking it behaves as it always
// did rather than becoming a dead button, and the kitchen is still reachable from its own
// section further down the page.
//
// This file exists at all because the Worker sends script-src 'self', so an inline script
// here would never execute and would give no sign of it.
(function () {
  var link = document.getElementById("signin-link");
  var dialog = document.getElementById("signin-choice");
  if (!link || !dialog || typeof dialog.showModal !== "function") return;
  link.addEventListener("click", function (event) {
    event.preventDefault();
    dialog.showModal();
  });
})();
