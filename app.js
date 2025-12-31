
// --- CONFIGURATION ---
// Ensure CONFIG is defined or replace this with your actual key string for testing
const GEMINI_API_KEY = (typeof CONFIG !== 'undefined') ? CONFIG.API_KEY : "YOUR_API_KEY_HERE";

const SYSTEM_PROMPT = `
You are a strict but helpful technical interviewer for a Google software engineer role. 
Keep your responses short (max 2 sentences). 
Based on the candidate's answer, ask a relevant follow-up technical question.
If the answer is bad, politely correct them and move on.
`;

// --- DOM ELEMENTS ---
const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const statusText = document.getElementById('head-shake');
const scoreText = document.getElementById('eye-contact-score');
const transcriptBox = document.getElementById('transcript-box');

// --- STATE VARIABLES ---
let nervousData = [];
let nervousLabels = [];
let nervousScore = 0;
let nervousChart;
let baselineFrames = 0;
let baselineDeviation = 0;
let baselineActive = true;
let geminiLocked = false;
let targetRole = "Software Engineer";
let userContext = "";
let totalFrames = 0;
let goodFrames = 0;
let isInterviewActive = false;
let silenceTimer = null; 
let contentScore = 0;
let fluencyScore = 0;
let confidenceScore = 100;
let lastNervous = 0;
let frozenNervous = 0;
let history = [];
let visualScores = [];
let frozenEye = 100;
let frozenFillers = 0;
let verificationFlags = [];

const fillerWords = ["um","uh","uhh","umm","hmm","like","basically","actually","i","maybe","probably"];
const powerWords  = ["built","led","designed","implemented","optimized","debugged","solved","architected"];

// --- HELPER FUNCTIONS ---

function extractGeminiText(data) {
    try {
        const parts = data.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
            if (p.text) return p.text;
        }
        return "Could you please repeat that?";
    } catch (e) {
        return "Could you please repeat that?";
    }
}

function heatmap(text){
  let t = text;
  fillerWords.forEach(w=>{
    t = t.replace(new RegExp(`\\b${w}\\b`, 'gi'), (match) => `<span style="color:#ef4444">${match}</span>`);
  });
  powerWords.forEach(w=>{
    t = t.replace(new RegExp(`\\b${w}\\b`, 'gi'), (match) => `<span style="color:#22c55e">${match}</span>`);
  });
  return t;
}

function safeAvg(arr, key){
  const v = arr.map(x=>x[key]).filter(x=>typeof x==="number");
  return v.length ? Math.round(v.reduce((a,b)=>a+b,0)/v.length) : 0;
}

function computeHireability(){
  if(history.length === 0) return 0;
  let sum = {content:0, fluency:0, confidence:0, visual:0};
  history.forEach(h=>{
    sum.content += h.content;
    sum.fluency += h.fluency;
    sum.confidence += h.confidence;
    sum.visual += h.visual;
  });
  const n = history.length;
  return Math.round(
    0.4*(sum.content/n) +
    0.3*(sum.confidence/n) +
    0.2*(sum.fluency/n) +
    0.1*(sum.visual/n)
  );
}

// --- SPEECH RECOGNITION ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();

recognition.continuous = true;
recognition.lang = 'en-US';
recognition.interimResults = true;

recognition.onresult = (event) => {
    clearTimeout(silenceTimer);

    let finalTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
        }
    }

    if (finalTranscript !== "") {
        transcriptBox.innerHTML += `<br><b>You:</b> ${heatmap(finalTranscript)}`;
        transcriptBox.scrollTop = transcriptBox.scrollHeight; // Auto-scroll

        silenceTimer = setTimeout(() => {
            if (isInterviewActive) {
                frozenNervous = lastNervous;
                frozenEye = Math.round((goodFrames / Math.max(1, totalFrames)) * 100);
                callGemini(finalTranscript); 

                if (frozenNervous > 60) {
                    setTimeout(() => {
                        speakText("Take a breath. You're doing okay. Try to slow down slightly.");
                    }, 1200);
                }
            }
        }, 2500);
    }
};

// --- GEMINI API ---
async function callGemini(userAnswer) {
    if (geminiLocked) return;
    geminiLocked = true;
    setTimeout(() => geminiLocked = false, 15000);
    if (!userAnswer) return;

    transcriptBox.innerHTML += `<br><b>🤖 AI Thinking...</b>`;
    
    // Sanitize input slightly to prevent JSON breakages
    const safeAnswer = userAnswer.replace(/"/g, "'");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const dynamicPrompt = `
        You are an expert technical interviewer.
        Evaluate the answer strictly. Return ONLY valid JSON.
        {
            "rating": "Weak/Average/Strong/Exceptional",
            "grammarErrors": number,
            "fillerCount": number,
            "verification": "OK/Gap",
            "verificationNote": "short reason",
            "improvementTip": "short tip",
            "followup": "next interview question"
        }
        Role: ${targetRole}
        Resume: ${userContext}
        Answer: "${safeAnswer}"
    `;

    const requestBody = { contents: [{ parts: [{ text: dynamicPrompt }] }] };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "API Error");

        const raw = extractGeminiText(data);
        const match = raw.match(/\{[\s\S]*\}/); // Find JSON block

        if (!match) throw new Error("AI Parse Error - No JSON found");

        const evalData = JSON.parse(match[0]);

        // UI Update
        transcriptBox.innerHTML += `
            <br><b style="color:#22c55e">Rating:</b> ${evalData.rating}
            <br><b>Tip:</b> ${evalData.improvementTip}
            <br><b style="color:#3b82f6">AI:</b> ${evalData.followup}<br>`;
        transcriptBox.scrollTop = transcriptBox.scrollHeight;

        // Speak
        if (frozenNervous > 70) evalData.followup = "Let's go slowly. " + evalData.followup;
        speakText(evalData.followup);

        // Scoring
        let currentContent = { Weak: 30, Average: 55, Strong: 80, Exceptional: 95 }[evalData.rating] || 50;
        let currentFluency = Math.max(0, 100 - (evalData.grammarErrors * 6) - (evalData.fillerCount * 4));
        let visualConf = Math.max(0, 100 - frozenNervous);
        let audioConf = Math.max(0, 100 - (evalData.fillerCount * 5));
        let combinedConfidence = (visualConf + audioConf) / 2;
        let penalty = (evalData.verification === "Gap") ? 10 : 0;

        history.push({
            content: currentContent,
            fluency: currentFluency,
            confidence: Math.max(0, combinedConfidence - penalty),
            visual: frozenEye
        });

    } catch (error) {
        console.error("API ERROR:", error);
        transcriptBox.innerHTML += `<br><b style="color:red">Error:</b> ${error.message}`;
        geminiLocked = false; // Unlock if error
    }
}

// --- TEXT TO SPEECH ---
function speakText(text){
  recognition.abort(); // Stop listening while speaking

  const speech = new SpeechSynthesisUtterance(text);
  speech.onend = () => {
    // Only restart listening if interview is still active
    if(isInterviewActive) {
        try {
            recognition.start();
        } catch (e) {
            console.log("Recognition already active");
        }
    }
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(speech);
}

// --- FACEMESH & CAMERA ---
function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        // Draw Mesh
        if(typeof drawConnectors !== 'undefined' && typeof FACEMESH_TESSELATION !== 'undefined') {
             drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });
        }

        const nose = landmarks[1];

        // Calc Deviation
        let deviation = Math.abs(nose.x - 0.5) * 100;
        if (baselineActive) {
            baselineFrames++;
            baselineDeviation += deviation;
            canvasCtx.restore();
            return;
        }

        // Calc Stress
        let avgBaseline = baselineDeviation / Math.max(1, baselineFrames);
        let stressDeviation = Math.max(0, deviation - avgBaseline); 
        nervousScore = Math.min(100, stressDeviation * 2.5); 
        lastNervous = nervousScore;
        
        // Update Graph
        if (isInterviewActive) {
            nervousData.push(nervousScore);
            nervousLabels.push('');
            if (nervousData.length > 30) {
                nervousData.shift();
                nervousLabels.shift();
            }
            nervousChart.data.datasets[0].data = nervousData;
            nervousChart.update();
        }

        // Eye Contact & Direction
        if (isInterviewActive) {
            totalFrames++;
            let isGood = (nose.x > 0.4 && nose.x < 0.6 && nose.y > 0.35 && nose.y < 0.75);
            if (isGood) goodFrames++;
            
            let percent = Math.round((goodFrames / Math.max(1, totalFrames)) * 100);
            if(scoreText) scoreText.innerText = percent + "%";

            if(statusText) {
                if (nervousScore > 50) document.querySelector('.video-container').style.borderColor = '#ef4444'; 
                else document.querySelector('.video-container').style.borderColor = '#3b82f6';

                if (nose.x < 0.4) { statusText.innerText = "Looking Right"; statusText.style.color = "#ef4444"; } 
                else if (nose.x > 0.6) { statusText.innerText = "Looking Left"; statusText.style.color = "#ef4444"; } 
                else if (nose.y < 0.35) { statusText.innerText = "Looking Up"; statusText.style.color = "#ef4444"; } 
                else if (nose.y > 0.75) { statusText.innerText = "Looking Down"; statusText.style.color = "#ef4444"; } 
                else { statusText.innerText = "Stable"; statusText.style.color = "#22c55e"; }
            }
        }
    }
    canvasCtx.restore();
}

// Initialize FaceMesh
const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
faceMesh.onResults(onResults);

let isProcessing = false;
let lastSend = 0;

const camera = new Camera(videoElement, {
  onFrame: async () => {
    if (isProcessing) return;
    if (Date.now() - lastSend < 100) return;
    isProcessing = true; 
    lastSend = Date.now();
    try { await faceMesh.send({ image: videoElement }); } 
    catch (error) { console.error(error); } 
    finally { isProcessing = false; }
  },
  width: 640,
  height: 480
});
camera.start();

// Initialize Chart
const ctx = document.getElementById('nervousChart').getContext('2d');
nervousChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: nervousLabels,
        datasets: [{
            label: 'Nervousness',
            data: nervousData,
            borderColor: '#ef4444',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
        }]
    },
    options: { 
        animation: false,
        responsive: true,
        scales: { y: { min: 0, max: 100, display: true }, x: { display: false } } 
    }
});



function startInterview(){
  baselineActive = true;
  baselineFrames = 0;
  baselineDeviation = 0;
  isInterviewActive = true;
  history = []; // Reset history
  totalFrames = 0;
  goodFrames = 0;

  // Let camera stabilize
  setTimeout(()=>{
    speakText("Calibration started. Please look naturally at the screen.");
  }, 400);

  setTimeout(()=>{
    baselineActive = false;
    speakText(`Calibration complete. I see you are applying for a ${targetRole} position. Tell me about yourself.`);
  }, 8500);
}

function stopInterview() {
    isInterviewActive = false;
    recognition.stop();
    window.speechSynthesis.cancel();
    const hireability = computeHireability();
    finalHeatmap();
    // Use a slight delay to allow UI to update before alert
    setTimeout(() => {
        alert(`REPORT:\nHireability: ${hireability}%\nContent: ${safeAvg(history, 'content')}\nConfidence: ${safeAvg(history, 'confidence')}`);
    }, 500);
}

function finalHeatmap() {
    document.body.innerHTML = `
    <div style="padding:20px; font-family:sans-serif; background:#111; color:white; min-height:100vh;">
        <h1>Interview Heatmap</h1>
        <div style="background:#222; padding:20px; border-radius:10px;">${transcriptBox.innerHTML}</div>
        <button onclick="location.reload()" style="margin-top:20px; padding:10px 20px;">Restart</button>
    </div>
  `;
}

function saveConfig() {
    const roleInput = document.getElementById('role-input');
    const resumeInput = document.getElementById('resume-input');
    
    if (roleInput && roleInput.value) targetRole = roleInput.value;
    if (resumeInput && resumeInput.value) userContext = resumeInput.value;

    const modal = document.getElementById('setup-modal');
    if(modal) modal.style.display = 'none';

    speakText(`Setup complete. Getting ready for a ${targetRole} interview.`);
}


document.addEventListener('DOMContentLoaded', () => {

    const startBtn = document.getElementById('start-btn'); // Ensure your HTML button has id="start-btn"
    if(startBtn) {
        startBtn.addEventListener('click', startInterview);
    } else {
        console.error("Button with ID 'start-btn' not found in HTML");
    }

    const stopBtn = document.getElementById('stop-btn'); // Ensure your HTML button has id="stop-btn"
    if(stopBtn) {
        stopBtn.addEventListener('click', stopInterview);
    }

    const saveBtn = document.getElementById('save-btn'); // Ensure your HTML button has id="save-btn"
    if(saveBtn) {
        saveBtn.addEventListener('click', saveConfig);
    }
});