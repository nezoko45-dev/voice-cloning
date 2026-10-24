const enabled=document.querySelector("#enabled");
const silence=document.querySelector("#silence");
const status=document.querySelector("#status");
chrome.storage.sync.get({enabled:false,silenceSeconds:2.5},settings=>{
 enabled.checked=settings.enabled;
 silence.value=settings.silenceSeconds;
});
document.querySelector("#save").addEventListener("click",()=>{
 const seconds=Math.min(10,Math.max(1,Number(silence.value)||2.5));
 chrome.storage.sync.set({enabled:enabled.checked,silenceSeconds:seconds},()=>{
  status.textContent="Settings saved.";
  setTimeout(()=>status.textContent="",1800);
 });
});