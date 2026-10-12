/* Email card: mail app on Mac / iOS / Android; Gmail compose in the browser on Windows / Linux desktops */
(function(){var a=document.getElementById('emailLink');if(!a)return;
var TO='info@twinstack.net',SU='Salesforce project enquiry',ua=navigator.userAgent||'';
var desktopNoMailApp=/Windows|Linux|CrOS/i.test(ua)&&!/Android|iPhone|iPad|Mobile/i.test(ua);
a.addEventListener('click',function(e){
  if(desktopNoMailApp){e.preventDefault();window.open('https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(TO)+'&su='+encodeURIComponent(SU),'_blank','noopener');}
  else{e.preventDefault();window.location.href='mailto:'+TO+'?subject='+encodeURIComponent(SU);}
});})();
