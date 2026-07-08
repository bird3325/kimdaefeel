// 김대필 (ContextWrite) Popup Window Script

let latestHumanizedText = '';
let selectedLevel = 'light';
let currentDetectedMode = 'resume';
let globalConfidences = { resume: 0, email: 0, sns: 0 };

document.addEventListener('DOMContentLoaded', () => {
  const modeSelect = document.getElementById('cdp-mode-select');
  const autoToggle = document.getElementById('cdp-auto-toggle');
  const settingsBtn = document.getElementById('cdp-settings-btn');
  
  const originalInput = document.getElementById('cdp-original-input');
  const levelBtns = document.querySelectorAll('.cdp-level-btn');
  const charLimitInput = document.getElementById('cdp-char-limit-input');
  const resultView = document.getElementById('cdp-humanized-result');
  const transformBtn = document.getElementById('cdp-transform-btn');
  
  const insertBtn = document.getElementById('cdp-insert-btn');
  const docxBtn = document.getElementById('cdp-docx-btn');
  
  const aiScoreVal = document.getElementById('cdp-ai-score-val');
  const aiScoreFill = document.getElementById('cdp-ai-score-fill');
  const atsScoreVal = document.getElementById('cdp-ats-score-val');
  const atsScoreFill = document.getElementById('cdp-ats-score-fill');

  const profileTone = document.getElementById('cdp-profile-tone');
  const profileExp = document.getElementById('cdp-profile-exp');
  const profileTarget = document.getElementById('cdp-profile-target');
  const profileJob = document.getElementById('cdp-profile-job');
  const profileEpisode = document.getElementById('cdp-profile-episode');
  const profilePersona = document.getElementById('cdp-profile-persona');

  // 1. 설정 진입
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'open-options' });
  });

  // 2. 모드 변경 시 라벨/플레이스홀더 동적 갱신
  modeSelect.addEventListener('change', (e) => {
    currentDetectedMode = e.target.value;
    updateProfileFields(currentDetectedMode);

    // 수동으로 모드를 변경했을 때도 해당 모드에 부합하는 신뢰도로 갱신
    const activeConfidence = globalConfidences[currentDetectedMode] || 0;
    if (confidenceBadge) {
      confidenceBadge.innerText = `신뢰도: ${activeConfidence}%`;
    }
  });

  // 3. 강도 선택
  levelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      levelBtns.forEach(b => b.classList.remove('cdp-active', 'cdp-active-mint'));
      selectedLevel = btn.getAttribute('data-level');
      if (selectedLevel === 'strong') {
        btn.classList.add('cdp-active-mint');
      } else {
        btn.classList.add('cdp-active');
      }
    });
  });

  // 4. 글자수 실시간 계산
  const updateCharCounts = () => {
    const origText = originalInput.value || '';
    const origCharCount = origText.length;
    const origCharNoSpaceCount = origText.replace(/\s/g, '').length;
    document.getElementById('cdp-orig-char-count').innerText = `${origCharCount}자 (공백 제외 ${origCharNoSpaceCount}자)`;

    const resultText = latestHumanizedText || '';
    const resultCharCount = resultText.length;
    const resultCharNoSpaceCount = resultText.replace(/\s/g, '').length;
    document.getElementById('cdp-result-char-count').innerText = `${resultCharCount}자 (공백 제외 ${resultCharNoSpaceCount}자)`;
  };
  originalInput.addEventListener('input', updateCharCounts);

  // 5. 프로필 자동 저장
  const saveProfile = () => {
    const mode = currentDetectedMode;
    const data = {};
    data[`${mode}_profileTone`] = profileTone.value;
    data[`${mode}_profileExp`] = profileExp.value;
    data[`${mode}_profileTarget`] = profileTarget.value;
    data[`${mode}_profileJob`] = profileJob.value;
    data[`${mode}_profileEpisode`] = profileEpisode.value;
    data[`${mode}_profilePersona`] = profilePersona.value;
    
    // 호환용 키
    data['profileTone'] = profileTone.value;
    data['profileExp'] = profileExp.value;
    data['profileTarget'] = profileTarget.value;
    data['profileJob'] = profileJob.value;
    data['profileEpisode'] = profileEpisode.value;
    data['profilePersona'] = profilePersona.value;

    chrome.storage.local.set(data);
  };
  profileTone.addEventListener('input', saveProfile);
  profileExp.addEventListener('input', saveProfile);
  profileTarget.addEventListener('input', saveProfile);
  profileJob.addEventListener('input', saveProfile);
  profileEpisode.addEventListener('input', saveProfile);
  if (profilePersona) {
    profilePersona.addEventListener('change', saveProfile);
  }

  // 6. 변환 실행
  transformBtn.addEventListener('click', () => {
    const text = originalInput.value;
    if (!text || text.trim() === '') {
      alert('AI 초안 텍스트를 입력해주세요.');
      return;
    }

    const charLimitVal = charLimitInput ? parseInt(charLimitInput.value, 10) : null;

    // 로딩바 표시 및 버튼 잠금
    resultView.innerHTML = `
      <div class="cdp-loading-container">
        <div class="cdp-spinner"></div>
        <div style="font-size: 13px; font-weight: 500; text-align: center;">AI가 자연스러운 문맥을 학습하여 교정 중입니다...</div>
        <div class="cdp-progress-bar-container">
          <div class="cdp-progress-bar-fill"></div>
        </div>
      </div>
    `;
    transformBtn.disabled = true;
    transformBtn.style.opacity = '0.6';
    transformBtn.innerText = '변환 중...';

    // 스토리지 프로필 로드 후 백그라운드로 전달
    chrome.storage.local.get(['profileTone', 'profileExp', 'profileTarget', 'profileJob', 'profileEpisode', 'profilePersona'], (res) => {
      const profile = {
        tone: res.profileTone || '',
        experience: res.profileExp || '',
        target: res.profileTarget || '',
        job: res.profileJob || '',
        episode: res.profileEpisode || ''
      };
      const persona = res.profilePersona || 'professor';

      const customInstruction = document.getElementById('cdp-custom-instruction') ? document.getElementById('cdp-custom-instruction').value : '';

      chrome.runtime.sendMessage({
        action: 'humanize',
        data: {
          text: text,
          level: selectedLevel,
          mode: currentDetectedMode,
          profile: profile,
          charLimit: isNaN(charLimitVal) ? null : charLimitVal,
          customInstruction: customInstruction,
          persona: persona
        }
      }, (response) => {
        transformBtn.disabled = false;
        transformBtn.style.opacity = '1';
        transformBtn.innerText = '자연화 변환';

        if (chrome.runtime.lastError || !response || !response.success) {
          alert('변환 실패. 다시 시도해 주세요.');
          resultView.innerHTML = '변환을 실행하면 여기에 인간다운 자연스러운 문장으로 변환되어 나타납니다.';
          return;
        }

        latestHumanizedText = response.humanizedText;
        renderHumanizedResult(response.humanizedText, response.warnings);
        updateCharCounts();
        updateDashboard(response.aiDetectionScore, response.atsScore);

        // 모델 배지 업데이트
        const modelNameText = document.getElementById('cdp-model-name-text');
        const modelStatusDot = document.getElementById('cdp-model-status-dot');
        if (modelNameText && response.modelUsed) {
          modelNameText.innerText = `AI 모델: ${response.modelUsed}`;
          if (modelStatusDot) {
            modelStatusDot.style.backgroundColor = response.modelUsed.includes('시뮬레이터') ? '#64748B' : '#0D9488';
          }
        }

        saveToHistory(currentDetectedMode, text, response.humanizedText);
      });
    });
  });

  // 7. 웹페이지에 즉시 삽입
  insertBtn.addEventListener('click', () => {
    if (!latestHumanizedText) {
      alert('먼저 자연화 변환을 수행해주세요.');
      return;
    }
    // 현재 활성화된 메인 브라우저 탭으로 삽입 메시지 전송
    chrome.tabs.query({ active: true, currentWindow: false }, (tabs) => {
      let targetTab = tabs && tabs[0];
      if (!targetTab) {
        // 백그라운드 윈도우 등 예외 상황 대비하여 전체 active tab 조회
        chrome.tabs.query({ active: true }, (allActiveTabs) => {
          const mainTab = allActiveTabs.find(t => !t.url.startsWith('chrome-extension://'));
          if (mainTab) {
            sendMessageToTab(mainTab.id);
          } else {
            alert('텍스트를 삽입할 메인 웹페이지 탭을 찾을 수 없습니다.');
          }
        });
      } else {
        sendMessageToTab(targetTab.id);
      }
    });
  });

  function sendMessageToTab(tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'insert-text',
      text: latestHumanizedText
    }, (res) => {
      if (chrome.runtime.lastError) {
        alert('해당 웹페이지와 연결할 수 없습니다. 페이지를 새로고침한 후 다시 시도해 주세요.');
      } else {
        alert('웹페이지의 입력창에 자연화 텍스트가 성공적으로 삽입되었습니다!');
      }
    });
  }

  // 8. DOCX 다운로드
  docxBtn.addEventListener('click', () => {
    const originalText = originalInput.value;
    if (!originalText || !latestHumanizedText) {
      alert('다운로드할 자연화 변환 데이터가 존재하지 않습니다.');
      return;
    }
    downloadDocx(originalText, latestHumanizedText);
  });

  // 초기 로드 및 임시 데이터 복구
  chrome.storage.local.get(['temp_originalText', 'temp_customInstruction', 'temp_mode', 'temp_confidence', 'temp_globalConfidences', 'temp_profileTarget', 'temp_profileJob'], (res) => {
    if (res.temp_mode) {
      modeSelect.value = res.temp_mode;
      currentDetectedMode = res.temp_mode;
    }
    
    if (res.temp_globalConfidences) {
      globalConfidences = res.temp_globalConfidences;
    }

    // 모드 갱신 후 프로필 로드
    updateProfileFields(currentDetectedMode);

    if (res.temp_originalText) {
      originalInput.value = res.temp_originalText;
    }
    if (res.temp_customInstruction) {
      const customInstEl = document.getElementById('cdp-custom-instruction');
      if (customInstEl) customInstEl.value = res.temp_customInstruction;
    }

    if (res.temp_profileTarget) {
      if (profileTarget) profileTarget.value = res.temp_profileTarget;
    }
    if (res.temp_profileJob) {
      if (profileJob) profileJob.value = res.temp_profileJob;
    }

    if (res.temp_confidence) {
      const confidenceBadge = document.getElementById('cdp-confidence-badge');
      if (confidenceBadge) confidenceBadge.innerText = res.temp_confidence;
    }
    
    updateCharCounts();
    loadAndRenderHistory();

    // 복구 후 즉시 임시 스토리지 비우기
    chrome.storage.local.remove(['temp_originalText', 'temp_customInstruction', 'temp_mode', 'temp_confidence', 'temp_globalConfidences', 'temp_profileTarget', 'temp_profileJob']);
  });

  const historyList = document.getElementById('cdp-history-list');
  if (historyList) {
    historyList.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('cdp-history-copy-btn')) {
        const text = target.getAttribute('data-text');
        navigator.clipboard.writeText(text).then(() => {
          alert('내역이 클립보드에 복사되었습니다!');
        });
      } else if (target.classList.contains('cdp-history-del-btn')) {
        const logId = parseInt(target.getAttribute('data-id'), 10);
        chrome.storage.local.get(['historyLogs'], (res) => {
          const logs = res.historyLogs || [];
          const updatedLogs = logs.filter(item => item.id !== logId);
          chrome.storage.local.set({ historyLogs: updatedLogs }, () => {
            loadAndRenderHistory();
          });
        });
      }
    });
  }
});

// 동적 라벨/플레이스홀더 변경 및 데이터 로드
function updateProfileFields(mode) {
  const profileTone = document.getElementById('cdp-profile-tone');
  const profileExp = document.getElementById('cdp-profile-exp');
  const profileTarget = document.getElementById('cdp-profile-target');
  const profileJob = document.getElementById('cdp-profile-job');
  const profileEpisode = document.getElementById('cdp-profile-episode');
  const profilePersona = document.getElementById('cdp-profile-persona');
  if (!profileTone || !profileExp || !profileTarget || !profileJob || !profileEpisode || !profilePersona) return;

  const labelTone = document.getElementById('cdp-label-tone');
  const labelExp = document.getElementById('cdp-label-exp');
  const labelTarget = document.getElementById('cdp-label-target');
  const labelJob = document.getElementById('cdp-label-job');
  const labelEpisode = document.getElementById('cdp-label-episode');

  if (mode === 'resume') {
    if (labelTone) labelTone.innerText = '원하는 말투/톤';
    profileTone.placeholder = '예: 차분하고 신뢰감을 주는 존댓말';
    if (labelExp) labelExp.innerText = '경력 및 백그라운드';
    profileExp.placeholder = '예: 3년차 프론트엔드 개발자';
    if (labelTarget) labelTarget.innerText = '지원회사';
    profileTarget.placeholder = '예: 네이버';
    if (labelJob) labelJob.innerText = '업직종';
    profileJob.placeholder = '예: IT/프론트엔드 개발자';
    if (labelEpisode) labelEpisode.innerText = '핵심 강점/에피소드';
    profileEpisode.placeholder = '자소서에 녹여내고 싶은 나만의 구체적인 에피소드나 역량 키워드';
  } else if (mode === 'email') {
    if (labelTone) labelTone.innerText = '이메일 말투/톤';
    profileTone.placeholder = '예: 격식 있고 정중한 비즈니스 톤';
    if (labelExp) labelExp.innerText = '발신자 직무/직책 및 회사';
    profileExp.placeholder = '예: ABC테크 마케팅팀 대리';
    if (labelTarget) labelTarget.innerText = '수신자 정보';
    profileTarget.placeholder = '예: 프로젝트 협력사';
    if (labelJob) labelJob.innerText = '관계/직급';
    profileJob.placeholder = '예: 담당 실장님';
    if (labelEpisode) labelEpisode.innerText = '자주 쓰는 문맥/요건';
    profileEpisode.placeholder = '이메일 본문에 자주 들어가는 주요 요청사항이나 양식 안내';
  } else if (mode === 'sns') {
    if (labelTone) labelTone.innerText = '포스팅 말투/톤';
    profileTone.placeholder = '예: 친근하고 이웃 소통을 이끄는 반말';
    if (labelExp) labelExp.innerText = '채널 주제 및 타깃';
    profileExp.placeholder = '예: IT 테크 정보 리뷰 블로그';
    if (labelTarget) labelTarget.innerText = '채널 주제';
    profileTarget.placeholder = '예: IT 테크 정보 리뷰';
    if (labelJob) labelJob.innerText = '타깃 독자층 및 관심사';
    profileJob.placeholder = '예: 2030 IT/테크 얼리어답터';
    if (labelEpisode) labelEpisode.innerText = '해시태그 및 핵심 키워드';
    profileEpisode.placeholder = '포스팅에 자주 삽입하고 싶은 대표 키워드와 태그 목록';
  }

  // 모드 데이터 복원
  chrome.storage.local.get([
    `${mode}_profileTone`, 
    `${mode}_profileExp`, 
    `${mode}_profileTarget`,
    `${mode}_profileJob`,
    `${mode}_profileEpisode`,
    `${mode}_profilePersona`
  ], (res) => {
    profileTone.value = res[`${mode}_profileTone`] || '';
    profileExp.value = res[`${mode}_profileExp`] || '';
    profileTarget.value = res[`${mode}_profileTarget`] || '';
    profileJob.value = res[`${mode}_profileJob`] || '';
    profileEpisode.value = res[`${mode}_profileEpisode`] || '';
    profilePersona.value = res[`${mode}_profilePersona`] || 'professor';
  });
}

// 하이라이팅 렌더링
function renderHumanizedResult(text, warnings) {
  const resultView = document.getElementById('cdp-humanized-result');
  if (!resultView) return;
  let html = text
    .replace(/(할 수 있었습니다|프로세스를 효율적으로|정중하고 부드러운|자연스럽게|성장하며|역량이|전문성은|신뢰감을|정중하고|요청이나|피드백이|협업을|이끌어내도록|몸에 익힐|자리 잡았습니다|도출하는 데|보완하여|극대화할 수)/g, '<span class="cdp-highlight">$1</span>');

  // 경고 알림 문구가 존재할 시 상단 경고 배너 삽입
  if (warnings && warnings.length > 0) {
    const warningBanner = `<div class="cdp-warning-banner" style="background-color: #FEF3C7; border: 1px solid #F59E0B; border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; font-size: 11.5px; color: #92400E; display: flex; flex-direction: column; gap: 4px; box-sizing: border-box; line-height: 1.4;"><div style="font-weight: 700; display: flex; align-items: center; gap: 4px; border-bottom: 1px solid rgba(245, 158, 11, 0.3); padding-bottom: 4px; margin-bottom: 2px;">⚠️ 입력 문맥 분석 주의 알림</div><div style="display: flex; flex-direction: column; gap: 4px; text-align: left;">${warnings.map(w => `<div style="display: flex; gap: 6px; align-items: flex-start; line-height: 1.4;"><span style="color: #F59E0B; font-weight: bold; flex-shrink: 0;">•</span><span style="flex-grow: 1;">${w}</span></div>`).join('')}</div></div>`;
    html = warningBanner + html;
  }

  resultView.innerHTML = html;
}

// 대시보드 게이지 업데이트
function updateDashboard(aiScore, atsScore) {
  const aiScoreVal = document.getElementById('cdp-ai-score-val');
  const aiScoreFill = document.getElementById('cdp-ai-score-fill');
  const atsScoreVal = document.getElementById('cdp-ats-score-val');
  const atsScoreFill = document.getElementById('cdp-ats-score-fill');

  if (aiScoreVal && aiScoreFill) {
    aiScoreVal.innerText = `${aiScore}%`;
    aiScoreFill.style.width = `${aiScore}%`;
  }
  if (atsScoreVal && atsScoreFill) {
    atsScoreVal.innerText = `${atsScore}%`;
    atsScoreFill.style.width = `${atsScore}%`;
  }
}

// DOCX 파일 빌더
function downloadDocx(original, humanized) {
  const docxContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <title>김대필 (ContextWrite) Report</title>
      <style>
        body { font-family: 'Malgun Gothic', Arial, sans-serif; line-height: 1.6; padding: 20px; }
        h1 { color: #1E40AF; border-bottom: 2px solid #1E40AF; padding-bottom: 8px; font-size: 18pt; }
        .section { margin-bottom: 24px; padding: 12px; border: 1.5px solid #E5E7EB; border-radius: 8px; }
        .title { font-weight: bold; font-size: 11pt; color: #1E40AF; margin-bottom: 8px; }
        .content { font-size: 10pt; color: #374151; }
      </style>
    </head>
    <body>
      <h1>김대필 (ContextWrite) 자연화 변환 리포트</h1>
      <p style="color: #6B7280; font-size: 9pt;">작성 시간: ${new Date().toLocaleString()}</p>
      
      <div class="section">
        <div class="title">[ 원본 AI 초안 ]</div>
        <div class="content">${original.replace(/\n/g, '<br/>')}</div>
      </div>
      
      <div class="section" style="border-color: #0D9488;">
        <div class="title" style="color: #0D9488;">[ 자연화 변환 결과물 ]</div>
        <div class="content">${humanized.replace(/\n/g, '<br/>')}</div>
      </div>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff' + docxContent], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `김대필_자연화결과_${new Date().toISOString().slice(0, 10)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 최근 변환 내역 로드 및 렌더링
 */
function loadAndRenderHistory() {
  const historyList = document.getElementById('cdp-history-list');
  if (!historyList) return;

  chrome.storage.local.get(['saveHistoryEnabled', 'historyLogs'], (res) => {
    const saveEnabled = res.saveHistoryEnabled !== false; // 기본값 true
    const logs = res.historyLogs || [];

    if (!saveEnabled) {
      historyList.innerHTML = `<div style="font-size: 11px; color: #94A3B8; text-align: center; padding: 16px 0;">설정에서 '작성 내역 자동 저장'이 비활성화 상태입니다.</div>`;
      return;
    }

    if (logs.length === 0) {
      historyList.innerHTML = `<div style="font-size: 11px; color: #94A3B8; text-align: center; padding: 16px 0;">저장된 최근 작성 내역이 없습니다.</div>`;
      return;
    }

    let html = '';
    logs.forEach(log => {
      let modeClass = 'resume';
      let modeName = '자소서';
      if (log.mode === 'email') { modeClass = 'email'; modeName = '이메일'; }
      if (log.mode === 'sns') { modeClass = 'sns'; modeName = 'SNS/블로그'; }

      // 텍스트 이스케이프 처리 (HTML 태그 오작동 방지)
      const cleanHumanizedText = (log.humanizedText || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

      html += `
        <div class="cdp-history-item">
          <div class="cdp-history-item-header">
            <span class="cdp-history-badge ${modeClass}">${modeName}</span>
            <span>${log.timestamp || ''}</span>
          </div>
          <div class="cdp-history-body">${cleanHumanizedText}</div>
          <div class="cdp-history-actions">
            <button class="cdp-history-btn cdp-history-copy-btn" data-text="${cleanHumanizedText}">복사</button>
            <button class="cdp-history-btn cdp-history-del-btn" data-id="${log.id}">삭제</button>
          </div>
        </div>
      `;
    });

    historyList.innerHTML = html;
  });
}

/**
 * 신규 변환 결과를 내역에 추가 저장
 */
function saveToHistory(mode, original, humanized) {
  chrome.storage.local.get(['saveHistoryEnabled', 'historyLogs'], (res) => {
    const saveEnabled = res.saveHistoryEnabled !== false;
    if (!saveEnabled) return;

    const logs = res.historyLogs || [];
    const dateStr = new Date().toLocaleString('ko-KR', { hour12: false }).slice(2, 16);

    const newLog = {
      id: Date.now(),
      timestamp: dateStr,
      mode: mode,
      originalText: original,
      humanizedText: humanized
    };

    const updatedLogs = [newLog, ...logs].slice(0, 20);

    chrome.storage.local.set({ historyLogs: updatedLogs }, () => {
      loadAndRenderHistory();
    });
  });
}
