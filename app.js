
const GEMINI_API_KEY = (typeof CONFIG !== 'undefined') ? CONFIG.API_KEY : "YOUR_API_KEY_HERE";

const SYSTEM_PROMPT = `
You are a strict but helpful technical interviewer for a Google software engineer role.
Keep your responses short (max 2 sentences).
Based on the candidate's answer, ask a relevant follow-up technical question.
If the answer is bad, politely correct them and move on.
`;

const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const statusText = document.getElementById('head-shake');
const scoreText = document.getElementById('eye-contact-score');
const transcriptBox = document.getElementById('transcript-box');

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

function updateMetricsUI() {
    if (history.length === 0) return;

    const hireability = computeHireability();
    const content = safeAvg(history, 'content');
    const confidence = safeAvg(history, 'confidence');
    const fluency = safeAvg(history, 'fluency');
    const visual = safeAvg(history, 'visual');

    const hireabilityNum = document.getElementById('hireability-number');
    const hireabilityRing = document.getElementById('hireability-ring');

    if (hireabilityNum) hireabilityNum.textContent = hireability;
    if (hireabilityRing) {
        const circumference = 2 * Math.PI * 80;
        const offset = circumference - (hireability / 100) * circumference;
        hireabilityRing.style.strokeDashoffset = offset;

        if (hireability >= 75) hireabilityRing.style.stroke = '#10b981';
        else if (hireability >= 50) hireabilityRing.style.stroke = '#f59e0b';
        else hireabilityRing.style.stroke = '#ef4444';
    }

    updateMetricBar('content-bar', 'content-score', content);
    updateMetricBar('confidence-bar', 'confidence-score', confidence);
    updateMetricBar('fluency-bar', 'fluency-score', fluency);
    updateMetricBar('visual-bar', 'visual-score', visual);

    const verdictBadge = document.getElementById('verdict-badge');
    if (verdictBadge) {
        const verdictText = verdictBadge.querySelector('.verdict-text');
        if (verdictText) {
            if (hireability >= 75) verdictText.textContent = 'Strong Candidate';
            else if (hireability >= 50) verdictText.textContent = 'Moderate Candidate';
            else verdictText.textContent = 'Needs Improvement';
        }
    }
}

function updateMetricBar(barId, scoreId, value) {
    const bar = document.getElementById(barId);
    const score = document.getElementById(scoreId);

    if (bar) bar.style.width = value + '%';
    if (score) score.textContent = value;
}

function addInsight(text, icon = '💡') {
    const insightsList = document.getElementById('insights-list');
    if (!insightsList) return;

    const insight = document.createElement('div');
    insight.className = 'insight-item';
    insight.innerHTML = `
        <span class="insight-icon">${icon}</span>
        <span class="insight-text">${text}</span>
    `;

    insightsList.insertBefore(insight, insightsList.firstChild);

    if (insightsList.children.length > 5) {
        insightsList.removeChild(insightsList.lastChild);
    }
}

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
        const placeholder = transcriptBox.querySelector('.transcript-placeholder');
        if (placeholder) placeholder.remove();

        transcriptBox.innerHTML += `<br><b>You:</b> ${heatmap(finalTranscript)}`;
        transcriptBox.scrollTop = transcriptBox.scrollHeight;

        silenceTimer = setTimeout(() => {
            if (isInterviewActive) {
                frozenNervous = lastNervous;
                frozenEye = Math.round((goodFrames / Math.max(1, totalFrames)) * 100);
                callGemini(finalTranscript);

                if (frozenNervous > 60) {
                    setTimeout(() => {
                        speakText("Take a breath. You're doing okay. Try to slow down slightly.");
                        addInsight("High nervousness detected. Remember to breathe.", '🧘');
                    }, 1200);
                }
            }
        }, 2500);
    }
};

async function callGemini(userAnswer) {
    if (geminiLocked) return;
    geminiLocked = true;
    setTimeout(() => geminiLocked = false, 15000);
    if (!userAnswer) return;

    transcriptBox.innerHTML += `<br><b style="color:#3b82f6">AI Thinking...</b>`;

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
        const match = raw.match(/\{[\s\S]*\}/);

        if (!match) throw new Error("AI Parse Error - No JSON found");

        const evalData = JSON.parse(match[0]);

        transcriptBox.innerHTML += `
            <br><b style="color:#22c55e">Rating:</b> ${evalData.rating}
            <br><b>Tip:</b> ${evalData.improvementTip}
            <br><b style="color:#3b82f6">AI:</b> ${evalData.followup}<br>`;
        transcriptBox.scrollTop = transcriptBox.scrollHeight;

        if (frozenNervous > 70) evalData.followup = "Let's go slowly. " + evalData.followup;
        speakText(evalData.followup);

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

        updateMetricsUI();

        if (evalData.rating === "Exceptional" || evalData.rating === "Strong") {
            addInsight("Excellent answer! Keep up the good work.", '⭐');
        } else if (evalData.verification === "Gap") {
            addInsight("Resume inconsistency detected: " + evalData.verificationNote, '⚠️');
        }

    } catch (error) {
        console.error("API ERROR:", error);
        transcriptBox.innerHTML += `<br><b style="color:red">Error:</b> ${error.message}`;
        geminiLocked = false;
    }
}

function speakText(text){
  recognition.abort();

  const speech = new SpeechSynthesisUtterance(text);
  speech.onend = () => {
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

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        if(typeof drawConnectors !== 'undefined' && typeof FACEMESH_TESSELATION !== 'undefined') {
             drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });
        }

        const nose = landmarks[1];

        let deviation = Math.abs(nose.x - 0.5) * 100;
        if (baselineActive) {
            baselineFrames++;
            baselineDeviation += deviation;
            canvasCtx.restore();
            return;
        }

        let avgBaseline = baselineDeviation / Math.max(1, baselineFrames);
        let stressDeviation = Math.max(0, deviation - avgBaseline);
        nervousScore = Math.min(100, stressDeviation * 2.5);
        lastNervous = nervousScore;

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

        if (isInterviewActive) {
            totalFrames++;
            let isGood = (nose.x > 0.4 && nose.x < 0.6 && nose.y > 0.35 && nose.y < 0.75);
            if (isGood) goodFrames++;

            let percent = Math.round((goodFrames / Math.max(1, totalFrames)) * 100);
            if(scoreText) scoreText.innerText = percent + "%";

            if(statusText) {
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
            tension: 0.2,
            fill: false
        }]
    },
    options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            y: { min: 0, max: 100, display: true, grid: { color: 'rgba(148, 163, 184, 0.1)' } },
            x: { display: false }
        }
    }
});

function startInterview(){
  baselineActive = true;
  baselineFrames = 0;
  baselineDeviation = 0;
  isInterviewActive = true;
  history = [];
  totalFrames = 0;
  goodFrames = 0;
  nervousData = [];
  nervousLabels = [];

  transcriptBox.innerHTML = '<div class="transcript-placeholder"><p>Calibrating camera...</p></div>';
  addInsight("Interview session started", '🎬');

  setTimeout(()=>{
    speakText("Calibration started. Please look naturally at the screen.");
    addInsight("Camera calibration in progress", '📹');
  }, 400);

  setTimeout(()=>{
    baselineActive = false;
    speakText(`Calibration complete. I see you are applying for a ${targetRole} position. Tell me about yourself.`);
    transcriptBox.innerHTML = '';
    addInsight("Ready for interview. AI is listening.", '🎤');
  }, 8500);
}

function stopInterview() {
    isInterviewActive = false;
    recognition.stop();
    window.speechSynthesis.cancel();

    const hireability = computeHireability();
    const content = safeAvg(history, 'content');
    const confidence = safeAvg(history, 'confidence');
    const fluency = safeAvg(history, 'fluency');
    const visual = safeAvg(history, 'visual');

    showReport(hireability, content, confidence, fluency, visual);
}

function showReport(hireability, content, confidence, fluency, visual) {
    const reportPage = document.getElementById('report-page');
    const studioLayout = document.querySelector('.studio-layout');

    if (reportPage) reportPage.classList.remove('hidden');
    if (studioLayout) studioLayout.style.display = 'none';

    const reportDate = document.getElementById('report-date');
    if (reportDate) reportDate.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const finalScoreNum = document.getElementById('final-score-number');
    const finalRing = document.getElementById('final-ring');

    if (finalScoreNum) {
        let currentScore = 0;
        const interval = setInterval(() => {
            currentScore += 1;
            finalScoreNum.textContent = currentScore;
            if (currentScore >= hireability) {
                clearInterval(interval);
                finalScoreNum.textContent = hireability;
            }
        }, 20);
    }

    if (finalRing) {
        const circumference = 2 * Math.PI * 80;
        const offset = circumference - (hireability / 100) * circumference;
        setTimeout(() => {
            finalRing.style.strokeDashoffset = offset;
            if (hireability >= 75) finalRing.style.stroke = '#10b981';
            else if (hireability >= 50) finalRing.style.stroke = '#f59e0b';
            else finalRing.style.stroke = '#ef4444';
        }, 500);
    }

    const verdictResult = document.getElementById('verdict-result');
    if (verdictResult) {
        if (hireability >= 75) {
            verdictResult.textContent = 'Placement Ready';
            verdictResult.style.background = 'rgba(16, 185, 129, 0.1)';
            verdictResult.style.color = '#10b981';
        } else if (hireability >= 50) {
            verdictResult.textContent = 'Moderate Performance';
            verdictResult.style.background = 'rgba(245, 158, 11, 0.1)';
            verdictResult.style.color = '#f59e0b';
        } else {
            verdictResult.textContent = 'Needs Improvement';
            verdictResult.style.background = 'rgba(239, 68, 68, 0.1)';
            verdictResult.style.color = '#ef4444';
        }
    }

    setTimeout(() => {
        updateReportBar('report-content-bar', 'report-content', content);
        updateReportBar('report-confidence-bar', 'report-confidence', confidence);
        updateReportBar('report-fluency-bar', 'report-fluency', fluency);
        updateReportBar('report-visual-bar', 'report-visual', visual);
    }, 800);

    const transcriptHeatmap = document.getElementById('report-transcript-content');
    if (transcriptHeatmap) {
        transcriptHeatmap.innerHTML = transcriptBox.innerHTML || '<p style="color: var(--text-muted)">No transcript available</p>';
    }

    const improvementTips = document.getElementById('improvement-tips');
    if (improvementTips) {
        const tips = [];
        if (content < 70) tips.push({ icon: '💼', text: 'Focus on providing more specific examples from your experience' });
        if (fluency < 70) tips.push({ icon: '💬', text: 'Practice reducing filler words and improving sentence structure' });
        if (confidence < 70) tips.push({ icon: '🎯', text: 'Work on maintaining composure and speaking with conviction' });
        if (visual < 70) tips.push({ icon: '👁️', text: 'Maintain better eye contact and stable head position' });

        if (tips.length === 0) {
            tips.push({ icon: '⭐', text: 'Excellent performance! Keep practicing to maintain this level' });
        }

        improvementTips.innerHTML = tips.map(tip => `
            <div class="insight-item">
                <span class="insight-icon">${tip.icon}</span>
                <span class="insight-text">${tip.text}</span>
            </div>
        `).join('');
    }
}

function updateReportBar(barId, scoreId, value) {
    const bar = document.getElementById(barId);
    const score = document.getElementById(scoreId);

    if (bar) bar.style.width = value + '%';
    if (score) score.textContent = value;
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
    const startBtn = document.getElementById('start-btn');
    if(startBtn) {
        startBtn.addEventListener('click', startInterview);
    }

    const stopBtn = document.getElementById('stop-btn');
    if(stopBtn) {
        stopBtn.addEventListener('click', stopInterview);
    }

    const saveBtn = document.getElementById('save-btn');
    if(saveBtn) {
        saveBtn.addEventListener('click', saveConfig);
    }

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const html = document.documentElement;
            const currentTheme = html.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', newTheme);

            const icon = themeToggle.querySelector('.theme-icon');
            if (icon) icon.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        });
    }

    const backBtn = document.getElementById('back-to-dashboard');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            const reportPage = document.getElementById('report-page');
            const studioLayout = document.querySelector('.studio-layout');

            if (reportPage) reportPage.classList.add('hidden');
            if (studioLayout) studioLayout.style.display = 'grid';

            location.reload();
        });
    }

    const downloadBtn = document.getElementById('download-report');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            alert('PDF download functionality will be available in production version. For now, use Print to PDF (Ctrl+P)');
        });
    }
});
