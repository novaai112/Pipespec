// Fills company details from config.js into every [data-co] element.
(function () {
  var C = window.APP_CONFIG || {};
  document.querySelectorAll('[data-co]').forEach(function (el) {
    var v = C[el.getAttribute('data-co')];
    if (v !== undefined && v !== null && v !== '') el.textContent = v;
  });
  document.querySelectorAll('[data-co-mail]').forEach(function (a) {
    if (C.SUPPORT_EMAIL) a.setAttribute('href', 'mailto:' + C.SUPPORT_EMAIL);
  });
  var b = document.getElementById('brand'); if (b && C.APP_NAME) b.textContent = C.APP_NAME;
  var y = document.getElementById('copy');
  if (y) y.textContent = '\u00a9 ' + new Date().getFullYear() + ' ' + (C.COMPANY_NAME || 'Nova AI Technologies');
  var f = document.getElementById('contact-form');
  if (f) f.addEventListener('submit', function (e) {
    e.preventDefault();
    var n = f.name.value.trim(), em = f.email.value.trim(), m = f.message.value.trim(), s = f.subject.value.trim() || 'Support request';
    var body = encodeURIComponent(m + '\n\n— ' + n + ' (' + em + ')');
    location.href = 'mailto:' + (C.SUPPORT_EMAIL || '') + '?subject=' + encodeURIComponent(s) + '&body=' + body;
  });
})();
