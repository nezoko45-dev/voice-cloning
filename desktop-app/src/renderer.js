const voiceSelect=document.getElementById("voiceSelect"),textInput=document.getElementById("textInput"),charCount=document.getElementById("charCount"),generateButton=document.getElementById("generateButton"),statusTitle=document.getElementById("statusTitle"),statusMessage=document.getElementById("statusMessage"),resultPanel=document.getElementById("resultPanel"),resultStatus=document.getElementById("resultStatus"),audioPlayer=document.getElementById("audioPlayer"),saveButton=document.getElementById("saveButton");
const bridgeToken=document.getElementById("bridgeToken"),bridgeStatus=document.getElementById("bridgeStatus"),copyBridgeToken=document.getElementById("copyBridgeToken");
let generatedPath=null;
function setStatus(title,message){statusTitle.textContent=title;statusMessage.textContent=message}
window.voiceStudio.onProgress(message=>setStatus("Kokoro TTS",message));
window.voiceStudio.onBridgeText(({text})=>{
  if(typeof text!=="string")return;
  textInput.value=text;
  charCount.textContent=textInput.value.length.toLocaleString()+" characters";
  textInput.focus();
  textInput.setSelectionRange(textInput.value.length,textInput.value.length);
  setStatus("Text received from Chrome","Review the imported text, choose a Kokoro voice, then click Generate speech.");
});
textInput.addEventListener("input",()=>{charCount.textContent=textInput.value.length.toLocaleString()+" characters"});
audioPlayer.addEventListener("error",()=>{setStatus("Audio generated but playback failed","Open Documents\\Voice Studio\\voice-studio-output.wav to play the saved WAV in your usual audio player.")});
generateButton.addEventListener("click",async()=>{
  const text=textInput.value.trim();
  if(!text)return setStatus("Add some text","Type or paste the words you want Kokoro to speak.");
  if(text.length>12000)return setStatus("Text is too long","Voice Studio accepts up to 12,000 characters per generation.");
  try{
    generateButton.disabled=true;
    generateButton.textContent="Generating…";
    setStatus("Preparing Kokoro","The first run downloads the local model. Your text is synthesized on this PC and saved to Documents\\Voice Studio\\voice-studio-output.wav.");
    const result=await window.voiceStudio.generate({text,voice:voiceSelect.value});
    generatedPath=result.outputPath;
    audioPlayer.pause();
    audioPlayer.src=result.audioUrl;
    audioPlayer.load();
    resultPanel.hidden=false;
    resultStatus.textContent="Generated · "+result.voice;
    setStatus("Speech generated","Kokoro spoke "+result.characters+" characters using "+result.voice+". Saved to Documents\\Voice Studio\\voice-studio-output.wav.");
    audioPlayer.play().catch(()=>{});
  }catch(error){
    setStatus("Generation failed",error.message||"Kokoro could not generate speech. Check the status messages and internet connection for the first model download.");
  }finally{
    generateButton.disabled=false;
    generateButton.innerHTML="▶ &nbsp; Generate speech";
  }
});
saveButton.addEventListener("click",async()=>{if(!generatedPath)return;await window.voiceStudio.showOutput(generatedPath)});
copyBridgeToken.addEventListener("click",async()=>{try{await window.voiceStudio.copyBridgeToken();copyBridgeToken.textContent="Copied";setTimeout(()=>copyBridgeToken.textContent="Copy token",1400)}catch{bridgeStatus.textContent="Could not copy token. Select and copy it manually."}});
(async()=>{
  try{const info=await window.voiceStudio.getBridgeInfo();bridgeToken.value=info.token;bridgeStatus.textContent="Running at http://"+info.host+":"+info.port+" while Voice Studio is open."}catch{bridgeStatus.textContent="Local extension bridge status unavailable."}
  try{const engine=await window.voiceStudio.getEngineStatus();if(engine.ready)setStatus("Kokoro ready",""+engine.version+" is loaded. Your model is cached locally.");else setStatus("Ready for Kokoro setup",engine.message)}catch{setStatus("Local engine status unavailable","Close and reopen the app, then check the runtime files.")}
})();
