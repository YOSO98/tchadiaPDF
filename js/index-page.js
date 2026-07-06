/* tchadiaPdf : comportements propres a la page d'accueil (sans attribut onchange inline, CSP stricte) */
(function () {
  var select = document.getElementById("langSwitch");
  if (!select) return;
  select.addEventListener("change", function () {
    if (select.value) window.location.href = select.value;
  });
})();
