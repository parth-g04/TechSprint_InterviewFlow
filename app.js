
const GEMINI_API_KEY = CONFIG.API_KEY;

const SYSTEM_PROMPT = `
You are a strict but helpful technical interviewer for a Google software engineer role. 
Keep your responses short (max 2 sentences). 
Based on the candidate's answer, ask a relevant follow-up technical question.
If the answer is bad, politely correct them and move on.
`


const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const statusText = document.getElementById('head-shake');
const scoreText = document.getElementById('eye-contact-score');
const transcriptBox = document.getElementById('transcript-box');

// State Variables
// Configuration State
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
let silenceTimer = null; // To detect when you finish speaking
let contentScore = 0;
let fluencyScore = 0;
let confidenceScore = 100;
let lastNervous = 0;
let frozenNervous = 0;
let history = [];
let visualScores = [];
let frozenEye = 100;
let frozenFillers = 0;




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

async function callGemini(userAnswer) {
    if (geminiLocked) return;
    geminiLocked = true;
    setTimeout(() => geminiLocked = false, 15000);
    if (!userAnswer) return;

    transcriptBox.innerHTML += `<br><b>🤖 AI Thinking...</b>`;
    console.log("Sending to Gemini:", userAnswer);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("PASTE")) {
        alert("CRITICAL ERROR: API Key is missing in config.js!");
        return;
    }

    const dynamicPrompt = `
                You are an expert technical interviewer and evaluator.

                Evaluate the candidate answer strictly and return ONLY valid JSON in this format:

                {
                "rating":"Weak/Average/Strong/Exceptional",
                "grammarErrors": number,
                "fillerCount": number,
                "star": { "situation":true/false,"task":true/false,"action":true/false,"result":true/false },
                "improvementTip":"short tip",
                "followup":"next interview question"
                }

                Role: ${targetRole}
                Resume: ${userContext}
                Answer: "${userAnswer}"
                `;


    const requestBody = {
        contents: [{
            parts: [{ text: dynamicPrompt }]
        }]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        // IF GOOGLE SAYS NO, SHOW THE REASON
        if (!response.ok) {
            console.error("API ERROR:", data);
            alert(`Google Error: ${data.error.message}`); // ALERT THE ERROR
            transcriptBox.innerHTML += `<br><b style="color:red">ERROR:</b> ${data.error.message}`;
            return;
        }

        // IF SUCCESS
        const raw = extractGeminiText(data);

        // Extract JSON even if Gemini talks before/after it
        const match = raw.match(/\{[\s\S]*\}/);

        if (!match) {
            transcriptBox.innerHTML += "<br><b style='color:red'>AI Parse Error. Please repeat.</b>";
            return;
        }

        let evalData;
        try {
            evalData = JSON.parse(match[0]);
        } catch {
            transcriptBox.innerHTML += "<br><b style='color:red'>AI Parse Error. Please repeat.</b>";
            return;
        }

        transcriptBox.innerHTML += `
<br><b style="color:#22c55e">Rating:</b> ${evalData.rating}
<br><b>Tip:</b> ${evalData.improvementTip}
<br><b style="color:#3b82f6">AI:</b> ${evalData.followup}<br>`;
        if (frozenNervous > 70) {
            evalData.followup = "Let's go slowly. " + evalData.followup;
        }

        speakText(evalData.followup);
        contentScore = { Weak: 30, Average: 55, Strong: 80, Exceptional: 95 }[evalData.rating];
        fluencyScore = Math.max(0, 100 - (evalData.grammarErrors * 6) - (evalData.fillerCount * 4));
        contentScore = Math.min(100, Math.max(0, contentScore));
        fluencyScore = Math.min(100, Math.max(0, fluencyScore));


    } catch (error) {
        console.error("NETWORK ERROR:", error);
        alert(`Network Error: ${error.message}`);
    }
    visualScores.push(100 - frozenNervous);
    const confidenceCalc = Math.max(0, 100 - frozenNervous - (evalData.fillerCount * 5));

    history.push({
        content: contentScore,
        fluency: fluencyScore,
        confidence: confidenceCalc,
        visual: frozenEye
    });

}


const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();

recognition.continuous = true;
recognition.lang = 'en-US';
recognition.interimResults = true;

recognition.onresult = (event) => {
    // 1. Clear the timer if user is still talking
    clearTimeout(silenceTimer);

    let finalTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
        }
    }

    if (finalTranscript !== "") {
        transcriptBox.innerHTML += `<br><b>You:</b> ${finalTranscript}`;

        // 2. Start Timer: If silence for 2.5 seconds, send to AI
        silenceTimer = setTimeout(() => {
            if (isInterviewActive) {
                frozenNervous = lastNervous;   // capture nervousness at answer time
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



function speakText(text) {
    // Pause recognition so AI doesn't hear itself
    recognition.stop();

    const speech = new SpeechSynthesisUtterance(text);
    speech.onend = function () {
        // Start listening again after AI finishes talking
        if (isInterviewActive) recognition.start();
    }
    window.speechSynthesis.speak(speech);
}


function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });

        const nose = landmarks[1];
        let status = "Stable";
        let isGood = true;

        if (nose.x < 0.4) { status = "Looking Left"; isGood = false; }
        if (nose.x > 0.6) { status = "Looking Right"; isGood = false; }
        if (nose.y < 0.4) { status = "Looking Up"; isGood = false; }
        if (nose.y > 0.7) { status = "Looking Down"; isGood = false; }

        statusText.innerText = status;
        let deviation = Math.abs(nose.x - 0.5) * 100;


        if (baselineActive) {
            baselineFrames++;
            baselineDeviation += deviation;
            return;
        }

        let avgBaseline = baselineDeviation / Math.max(1, baselineFrames);
        let stressDeviation = Math.max(0, deviation - avgBaseline);
        nervousScore = Math.min(100, stressDeviation * 2);
        lastNervous = nervousScore;
        confidenceScore = Math.max(0, 100 - nervousScore);


        if (isInterviewActive) {
            nervousData.push(nervousScore);
            nervousLabels.push('');
            if (nervousData.length > 20) {
                nervousData.shift();
                nervousLabels.shift();
            }
            nervousChart.update();
        }
        if (nervousScore > 60) {
            document.querySelector('.video-container').style.borderColor = '#f59e0b'; // amber
        } else {
            document.querySelector('.video-container').style.borderColor = '#3b82f6';
        }


        if (isInterviewActive) {
            totalFrames++;
            if (isGood) goodFrames++;
            let percent = Math.round((goodFrames / totalFrames) * 100);
            scoreText.innerText = percent + "%";
            statusText.style.color = isGood ? "#10b981" : "#ef4444";
        }
    }
    if(isInterviewActive && nervousScore < 30){
        document.querySelector('.video-container').style.boxShadow = '0 0 18px #22c55e';

    }
    canvasCtx.restore();
}

const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
faceMesh.onResults(onResults);

let lastSend = 0;

const camera = new Camera(videoElement, {
    onFrame: async () => {
        if (Date.now() - lastSend < 100) return;   // 10 FPS cap
        lastSend = Date.now();
        await faceMesh.send({ image: videoElement });
    },
    width: 640, height: 480
});
camera.start();

const ctx = document.getElementById('nervousChart').getContext('2d');

nervousChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: nervousLabels,
        datasets: [{
            label: 'Nervousness',
            data: nervousData,
            borderWidth: 2,
            tension: 0.4
        }]
    },
    options: { scales: { y: { min: 0, max: 100 } } }
});


function startInterview(){
  baselineActive = true;
  baselineFrames = 0;
  baselineDeviation = 0;
  isInterviewActive = true;

  speakText("Calibration started. Please look naturally at the screen.");

  setTimeout(()=>{
    baselineActive = false;
    speakText("Calibration complete. Tell me about yourself.");
  }, 8000);
}


function stopInterview(){
  isInterviewActive = false;
  recognition.stop();
  window.speechSynthesis.cancel();

  const hireability = computeHireability();

  alert(
    `Interview Complete\n\n` +
    `Hireability Score: ${hireability}\n\n` +
    `Content: ${Math.round(history.reduce((s,h)=>s+h.content,0)/history.length)}\n` +
    `Confidence: ${Math.round(history.reduce((s,h)=>s+h.confidence,0)/history.length)}\n` +
    `Fluency: ${Math.round(history.reduce((s,h)=>s+h.fluency,0)/history.length)}\n` +
    `Visual: ${Math.round(history.reduce((s,h)=>s+h.visual,0)/history.length)}`
  );
}

function saveConfig() {
    const role = document.getElementById('role-input').value;
    const resume = document.getElementById('resume-input').value;

    if (role) targetRole = role;
    if (resume) userContext = resume;

    // Hide the modal
    document.getElementById('setup-modal').style.display = 'none';

    speakText(`Setup complete. Getting ready for a ${targetRole} interview.`);
}
