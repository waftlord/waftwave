(function () {
  const s = document.createElement('script');
  s.src = 'https://storage.ko-fi.com/cdn/scripts/overlay-widget.js';
  s.onload = function () {
    kofiWidgetOverlay.draw('waftsoft', {
      type: 'floating-chat',
      'floating-chat.donateButton.text': 'Support Waft Tools',
      'floating-chat.donateButton.background-color': '#0077cc',
      'floating-chat.donateButton.text-color': '#fff'
    });
  };
  document.body.appendChild(s);
})();