document.documentElement.className+=' js';
(function(){var n=document.getElementById('nav'),t=0;
function u(){n.classList.toggle('docked',(window.scrollY||document.documentElement.scrollTop)>26);t=0}
window.addEventListener('scroll',function(){if(!t){requestAnimationFrame(u);t=1}},{passive:true});u();
if('IntersectionObserver' in window){var o=new IntersectionObserver(function(e){e.forEach(function(x){
if(x.isIntersecting){x.target.classList.add('in');o.unobserve(x.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.06});
var a=document.querySelectorAll('.rv');for(var i=0;i<a.length;i++){a[i].style.transitionDelay=(i%3)*70+'ms';o.observe(a[i])}}
else{var b=document.querySelectorAll('.rv');for(var j=0;j<b.length;j++)b[j].classList.add('in')}})();