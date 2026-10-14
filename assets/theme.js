/* Shared light/dark theme for the FRM and Scout pages.
   Loaded in <head> (before first paint) so the saved theme is applied with no flash.
   Default is dark; the choice is remembered in this browser only. */
(function () {
  'use strict';
  var KEY = 'lvlup_theme';
  var root = document.documentElement;

  function read() {
    try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; }
  }
  function apply(theme) { root.setAttribute('data-theme', theme); }
  function sync() {
    var b = document.getElementById('themeToggle');
    if (!b) return;
    var dark = root.getAttribute('data-theme') === 'dark';
    b.setAttribute('aria-checked', dark ? 'true' : 'false');
    b.title = dark ? 'Dark mode on. Click for light mode' : 'Light mode on. Click for dark mode';
  }
  function set(theme) {
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode: theme still applies for this visit */ }
    sync();
  }

  apply(read());

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('themeToggle');
    if (b) b.addEventListener('click', function () { set(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });
    sync();
  });
  // keep two open tabs in step
  window.addEventListener('storage', function (e) { if (e.key === KEY) { apply(read()); sync(); } });
})();
