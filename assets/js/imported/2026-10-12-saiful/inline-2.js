    // Inline CF email decoder — replaces external cloudflare-static script
    document.addEventListener('DOMContentLoaded',function(){
        document.querySelectorAll('[data-cfemail]').forEach(function(el){
            var e=el.getAttribute('data-cfemail'),s='',r=parseInt(e.substr(0,2),16);
            for(var i=2;i<e.length;i+=2)s+=String.fromCharCode(parseInt(e.substr(i,2),16)^r);
            el.textContent=s;
            var a=el.closest('a');if(a)a.href='mailto:'+s;
        });
    });
    