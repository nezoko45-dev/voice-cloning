const voiceSelect=document.getElementById("voiceSelect"),textInput=document.getElementById("textInput"),charCount=document.getElementById("charCount"),generateButton=document.getElementById("generateButton"),statusTitle=document.getElementById("statusTitle"),statusMessage=document.getElementById("statusMessage"),resultPanel=document.getElementById("resultPanel"),resultStatus=document.getElementById("resultStatus"),audioPlayer=document.getElementById("audioPlayer"),saveButton=document.getElementById("saveButton");
const bridgeToken=document.getElementById("bridgeToken"),bridgeStatus=document.getElementById("bridgeStatus"),copyBridgeToken=document.getElementById("copyBridgeToken");
const chooseOutputButton=document.getElementById("chooseOutputButton"),outputPathLabel=document.getElementById("outputPathLabel");
const startListeningButton=document.getElementById("startListeningButton"),stopListeningButton=document.getElementById("stopListeningButton"),silenceSelect=document.getElementById("silenceSelect"),autoGenerateCheckbox=document.getElementById("autoGenerateCheckbox");
let mediaStream=null,mediaRecorder=null,recordingChunks=[],audioContext=null,analyserFrame=0,lastVoiceAt=0,heardVoice=false,stopRequested=false;
let generatedPath=null;
let selectedOutputPath=null;
const defaultOutputPath="Documents\\Voice Studio\\voice-studio-output.wav";
function displayOutputPath(path){outputPathLabel.textContent=path||defaultOutputPath;outputPathLabel.title=path||defaultOutputPath}
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
function setListeningUi(listening){
  startListeningButton.disabled=listening;
  stopListeningButton.disabled=!listening;
  silenceSelect.disabled=listening;
}
function stopListening(){
  if(mediaRecorder&&mediaRecorder.state!=="inactive"){
    stopRequested=true;
    mediaRecorder.stop();
  }
}
function resampleTo16k(audioBuffer){
  const targetRate=16000, sourceRate=audioBuffer.sampleRate;
  const length=Math.max(1,Math.floor(audioBuffer.length*targetRate/sourceRate));
  const mono=new Float32Array(length);
  const channels=[];
  for(let ch=0;ch<audioBuffer.numberOfChannels;ch++)channels.push(audioBuffer.getChannelData(ch));
  const ratio=sourceRate/targetRate;
  for(let i=0;i<length;i++){
    const pos=i*ratio, left=Math.floor(pos), right=Math.min(left+1,audioBuffer.length-1), mix=pos-left;
    let sample=0;
    for(const channel of channels)sample+=channel[left]*(1-mix)+channel[right]*mix;
    mono[i]=sample/channels.length;
  }
  return mono;
}
function monitorSilence(){
  if(!analyserFrame||!audioContext||!mediaRecorder||mediaRecorder.state==="inactive")return;
  const analyser=audioContext.__voiceAnalyser;
  if(analyser){
    const data=new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum=0;
    for(let i=0;i<data.length;i++){const value=(data[i]-128)/128;sum+=value*value}
    const rms=Math.sqrt(sum/data.length);
    if(rms>0.022){heardVoice=true;lastVoiceAt=Date.now()}
    else if(heardVoice&&Date.now()-lastVoiceAt>=Number(silenceSelect.value)*1000){stopListening();return}
  }
  analyserFrame=requestAnimationFrame(monitorSilence);
}
startListeningButton.addEventListener("click",async()=>{
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||typeof MediaRecorder==="undefined"){
    setStatus("Microphone unavailable","This Windows build cannot access a microphone recording API. Check microphone permissions and try again.");return;
  }
  try{
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    audioContext=new AudioContext();
    await audioContext.resume();
    const source=audioContext.createMediaStreamSource(mediaStream);
    const analyser=audioContext.createAnalyser();analyser.fftSize=2048;source.connect(analyser);audioContext.__voiceAnalyser=analyser;
    const options=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?{mimeType:"audio/webm;codecs=opus"}:{};
    mediaRecorder=new MediaRecorder(mediaStream,options);recordingChunks=[];heardVoice=false;lastVoiceAt=0;stopRequested=false;
    mediaRecorder.addEventListener("dataavailable",event=>{if(event.data&&event.data.size)recordingChunks.push(event.data)});
    mediaRecorder.addEventListener("stop",async()=>{
      cancelAnimationFrame(analyserFrame);analyserFrame=0;
      if(mediaStream)mediaStream.getTracks().forEach(track=>track.stop());
      mediaStream=null;setListeningUi(false);
      const blob=new Blob(recordingChunks,{type:mediaRecorder.mimeType||"audio/webm"});
      recordingChunks=[];
      try{
        if(!heardVoice||blob.size===0)throw new Error("No speech was detected. Press Start listening and speak clearly.");
        setStatus("Preparing transcription","Converting microphone audio for local offline speech recognition…");
        const decoded=await audioContext.decodeAudioData(await blob.arrayBuffer());
        const samples=resampleTo16k(decoded);
        if(audioContext){await audioContext.close().catch(()=>{});audioContext=null}
        setStatus("Transcribing locally","The first run downloads a Whisper model; after that, recognition runs on this PC.");
        const result=await window.voiceStudio.transcribe(samples);
        textInput.value=result.text;
        charCount.textContent=textInput.value.length.toLocaleString()+" characters";
        textInput.focus();textInput.setSelectionRange(textInput.value.length,textInput.value.length);
        if(!textInput.value.trim())throw new Error("No speech was recognized. Please try again.");
        setStatus("Transcription complete","Recognized "+textInput.value.length+" characters using the local Whisper model.");
        if(autoGenerateCheckbox.checked){
          setStatus("Starting speech generation","Transcription is complete; Voice Studio will now generate speech.");
          generateButton.click();
        }
      }catch(error){
        if(audioContext){await audioContext.close().catch(()=>{});audioContext=null}
        setStatus("Voice input failed",error.message||"Could not transcribe the recording. Please try again.");
      }
    },{once:true});
    mediaRecorder.start(250);
    setListeningUi(true);
    setStatus("Listening","Speak now. Voice Studio stops recording after "+silenceSelect.value+" second(s) of silence.");
    analyserFrame=requestAnimationFrame(monitorSilence);
  }catch(error){
    if(mediaStream)mediaStream.getTracks().forEach(track=>track.stop());mediaStream=null;
    if(audioContext){await audioContext.close().catch(()=>{});audioContext=null}
    setListeningUi(false);
    setStatus("Could not start microphone",error.message||"Allow microphone access in Windows and try again.");
  }
});
stopListeningButton.addEventListener("click",()=>stopListening());

audioPlayer.addEventListener("error",()=>{setStatus("Audio generated but playback failed","Open Documents\\Voice Studio\\voice-studio-output.wav to play the saved WAV in your usual audio player.")});
generateButton.addEventListener("click",async()=>{
  const text=textInput.value.trim();
  if(!text)return setStatus("Add some text","Type or paste the words you want Kokoro to speak.");
  if(text.length>12000)return setStatus("Text is too long","Voice Studio accepts up to 12,000 characters per generation.");
  try{
    generateButton.disabled=true;
    generateButton.textContent="Generating…";
    setStatus("Preparing Kokoro","The first run downloads the local model. Your text is synthesized on this PC and saved to your selected WAV location.");
    const result=await window.voiceStudio.generate({text,voice:voiceSelect.value,outputPath:selectedOutputPath||undefined});
    generatedPath=result.outputPath;
    audioPlayer.pause();
    audioPlayer.src=result.audioUrl;
    audioPlayer.load();
    resultPanel.hidden=false;
    resultStatus.textContent="Generated · "+result.voice;
    displayOutputPath(result.outputPath);
    selectedOutputPath=result.outputPath;
    setStatus("Speech generated","Kokoro spoke "+result.characters+" characters using "+result.voice+". Saved to "+result.outputPath+".");
    audioPlayer.play().catch(()=>{});
  }catch(error){
    setStatus("Generation failed",error.message||"Kokoro could not generate speech. Check the status messages and internet connection for the first model download.");
  }finally{
    generateButton.disabled=false;
    generateButton.innerHTML="▶ &nbsp; Generate speech";
  }
});
chooseOutputButton.addEventListener("click",async()=>{
  try{
    const chosen=await window.voiceStudio.chooseOutput(selectedOutputPath||undefined);
    if(!chosen)return;
    selectedOutputPath=chosen;
    displayOutputPath(chosen);
    setStatus("Output location selected","New speech will be saved to "+chosen+".");
  }catch(error){setStatus("Could not select output location",error.message||"Please try again.")}
});
saveButton.addEventListener("click",async()=>{if(!generatedPath)return;await window.voiceStudio.showOutput(generatedPath)});
copyBridgeToken.addEventListener("click",async()=>{try{await window.voiceStudio.copyBridgeToken();copyBridgeToken.textContent="Copied";setTimeout(()=>copyBridgeToken.textContent="Copy token",1400)}catch{bridgeStatus.textContent="Could not copy token. Select and copy it manually."}});
(async()=>{
  displayOutputPath(selectedOutputPath);
  try{const info=await window.voiceStudio.getBridgeInfo();bridgeToken.value=info.token;bridgeStatus.textContent="Running at http://"+info.host+":"+info.port+" while Voice Studio is open."}catch{bridgeStatus.textContent="Local extension bridge status unavailable."}
  try{const engine=await window.voiceStudio.getEngineStatus();if(engine.ready)setStatus("Kokoro ready",""+engine.version+" is loaded. Your model is cached locally.");else setStatus("Ready for Kokoro setup",engine.message)}catch{setStatus("Local engine status unavailable","Close and reopen the app, then check the runtime files.")}
})();
