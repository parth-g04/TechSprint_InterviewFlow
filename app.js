
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
let targetRole = "Software Engineer";
let userContext = "";
let totalFrames = 0;
let goodFrames = 0;
let isInterviewActive = false;
let silenceTimer = null; // To detect when you finish speaking


async function callGemini(userAnswer) {
    if (!userAnswer) return;

    transcriptBox.innerHTML += `<br><b>🤖 AI Thinking...</b>`;
    console.log("Sending to Gemini:", userAnswer); 

    // Using Gemini 2.0 Flash Experimental (Fastest + Free Quota)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`;
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("PASTE")) {
        alert("CRITICAL ERROR: API Key is missing in config.js!");
        return;
    }

    const dynamicPrompt = `
    You are a technical interviewer for a '${targetRole}' role.
    Context: ${userContext}.
    Candidate said: "${userAnswer}"
    
    Reply in 2 sentences max. Ask a follow up question.
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
        const aiResponse = data.candidates[0].content.parts[0].text;
        transcriptBox.innerHTML += `<br><b style="color:#3b82f6">AI:</b> ${aiResponse}<br>`;
        speakText(aiResponse);

    } catch (error) {
        console.error("NETWORK ERROR:", error);
        alert(`Network Error: ${error.message}`);
    }
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
                callGemini(finalTranscript);
            }
        }, 2500); 
    }
};


function speakText(text) {
    // Pause recognition so AI doesn't hear itself
    recognition.stop(); 

    const speech = new SpeechSynthesisUtterance(text);
    speech.onend = function() {
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
        drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {color: '#C0C0C070', lineWidth: 1});

        const nose = landmarks[1];
        let status = "Stable";
        let isGood = true;

        if (nose.x < 0.4) { status = "Looking Left"; isGood = false; }
        if (nose.x > 0.6) { status = "Looking Right"; isGood = false; }
        if (nose.y < 0.4) { status = "Looking Up"; isGood = false; }
        if (nose.y > 0.7) { status = "Looking Down"; isGood = false; }

        statusText.innerText = status;
        
        if(isInterviewActive) {
            totalFrames++;
            if(isGood) goodFrames++;
            let percent = Math.round((goodFrames / totalFrames) * 100);
            scoreText.innerText = percent + "%";
            statusText.style.color = isGood ? "#10b981" : "#ef4444";
        }
    }
    canvasCtx.restore();
}

const faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
faceMesh.setOptions({maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});
faceMesh.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => { await faceMesh.send({image: videoElement}); },
    width: 640, height: 480
});
camera.start();


function startInterview() {
    isInterviewActive = true;
    speakText("Hello. I am Gemini. Let's start the interview. Tell me about yourself.");
}

function stopInterview() {
    isInterviewActive = false;
    recognition.stop();
    window.speechSynthesis.cancel(); // Stop talking
    alert(`Interview Over!\nEye Contact Score: ${scoreText.innerText}`);
}
function saveConfig() {
    const role = document.getElementById('role-input').value;
    const resume = document.getElementById('resume-input').value;
    
    if(role) targetRole = role;
    if(resume) userContext = resume;

    // Hide the modal
    document.getElementById('setup-modal').style.display = 'none';

    speakText(`Setup complete. Getting ready for a ${targetRole} interview.`);
}
