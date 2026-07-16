// 김대필 (ContextWrite) Options Script

document.addEventListener('DOMContentLoaded', () => {
  const providerSelect = document.getElementById('ai-provider');
  const modelInput = document.getElementById('ai-model');
  const apiKeyInput = document.getElementById('api-key');
  const factPolicyInput = document.getElementById('fact-policy');
  const btnSave = document.getElementById('btn-save');
  const statusMsg = document.getElementById('status-msg');
  const modelHint = document.getElementById('model-hint');

  const DEFAULT_NVIDIA_KEY = "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";
  const MASKED_KEY_DUMMY = "••••••••••••••••••••••••••••••••";

  // 제공사별 키/모델 임시 캐싱 객체
  let savedKeys = {
    openai: '',
    gemini: '',
    nvidia: '',
    default_nvidia: MASKED_KEY_DUMMY
  };

  let savedModels = {
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
    nvidia: 'meta/llama-3.3-70b-instruct',
    default_nvidia: 'nvidia/nemotron-mini-4b-instruct'
  };

  // 제공업체별 기본 추천 모델 힌트 제공 및 추천 가이드 업데이트
  const updateModelPlaceholder = () => {
    const provider = providerSelect.value;
    const guideDiv = document.getElementById('ai-recommendation-guide');
    const guideTitle = document.getElementById('rec-guide-title');
    const guideContent = document.getElementById('rec-guide-content');

    document.getElementById('model-group').style.display = 'block';
    document.getElementById('api-key-group').style.display = 'block';
    guideDiv.style.display = 'block';
    
    // 제공사 선택에 따른 모델명 및 API 키 활성화/비활성화 통제
    if (provider === 'default_nvidia') {
      modelInput.value = 'nvidia/nemotron-mini-4b-instruct'; 
      modelInput.readOnly = true; // 기본 모델의 모델명 강제 고정 및 수정 불가
      modelInput.style.backgroundColor = '#F3F4F6';
      
      apiKeyInput.value = MASKED_KEY_DUMMY;
      apiKeyInput.readOnly = true; // 기본 모델의 API Key 임의 조작/수정 불가 락(Lock)
      apiKeyInput.style.backgroundColor = '#F3F4F6';
      
      modelInput.placeholder = 'nvidia/nemotron-mini-4b-instruct';
      modelHint.innerText = '기본으로 제공되는 고정형 대필 최적화 AI 모델입니다. (수정 불가)';
      
      guideDiv.style.backgroundColor = '#FDF2F8';
      guideDiv.style.border = '1px solid #FBCFE8';
      guideDiv.style.color = '#9D174D';
      guideTitle.innerHTML = '⚡ 기본 모델 (무료 고속 연동) 적용 중';
      guideContent.innerHTML = `
        김대필의 내장 전용 망을 통과하여 한도나 이용 제한 없이 자연화 작문을 수행합니다.<br/>
        <strong>작성 엔진:</strong> <code style="background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">nvidia/nemotron-mini-4b-instruct</code> (대필 특화 소형 고성능 모델)<br/>
        <span style="color:#be185d; font-weight:bold;">🔒 보안 보호 규정:</span> 모델명과 연동 키는 외부 유출이나 실수로 인한 변경을 완벽하게 방지하기 위해 쓰기 금지(Read-only) 상태로 운영됩니다.
      `;
    } else {
      modelInput.readOnly = false; // 타 제공사는 자유롭게 수정 가능
      modelInput.style.backgroundColor = '#FFFFFF';
      modelInput.value = savedModels[provider] || '';
      
      apiKeyInput.readOnly = false; // 타 제공사 키 기입 가능
      apiKeyInput.style.backgroundColor = '#FFFFFF';
      apiKeyInput.value = savedKeys[provider] || '';

      if (provider === 'openai') {
        modelInput.placeholder = 'gpt-4o-mini (권장) 또는 gpt-4o';
        modelHint.innerText = 'OpenAI 모델을 입력하세요.';
        
        guideDiv.style.backgroundColor = '#F0FDF4';
        guideDiv.style.border = '1px solid #BBF7D0';
        guideDiv.style.color = '#166534';
        guideTitle.innerHTML = '📝 OpenAI (ChatGPT) 추천 가이드';
        guideContent.innerHTML = `
          글의 논리적인 뼈대를 잡고 문장 맞춤법을 정확하게 교정하며, 비즈니스 이메일의 단정하고 신뢰감 있는 격식 톤을 맞추는 데 가장 권장되는 AI입니다.<br/>
          <strong>추천 모델:</strong> <code style="background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">gpt-4o-mini</code> (신속한 응답 및 저렴한 사용료) 또는 <code style="background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">gpt-4o</code> (초정밀 교정)<br/>
          <strong style="color:#0f766e; display:inline-block; margin-top:10px; margin-bottom: 4px;">🔑 API 키 발급 상세 절차:</strong>
          <ol style="margin: 0; padding-left: 18px; line-height: 1.6; font-size: 12.5px;">
            <li><a href="https://platform.openai.com/api-keys" target="_blank" style="color: #0f766e; font-weight: bold; text-decoration: underline;">OpenAI API Keys 페이지</a>에 가입/로그인합니다.</li>
            <li>API 결제를 위해 <strong>[Settings] ➔ [Billing]</strong>에서 해외 결제 카드로 최소 $5 이상 선충전(Credit)을 등록해 두셔야 작동합니다. (ChatGPT Plus 구독과는 무관)</li>
            <li><strong>[Create new secret key]</strong>를 눌러 키를 생성한 뒤 즉시 복사하여 안전한 곳에 저장하고, 김대필 설정창에 붙여넣습니다. (창을 닫으면 재확인이 불가합니다.)</li>
          </ol>
        `;
      } else if (provider === 'gemini') {
        modelInput.placeholder = 'gemini-2.0-flash (권장) 또는 gemini-2.0-pro';
        modelHint.innerText = 'Google Gemini 모델을 입력하세요.';
        
        guideDiv.style.backgroundColor = '#F5F3FF';
        guideDiv.style.border = '1px solid #DDD6FE';
        guideDiv.style.color = '#5B21B6';
        guideTitle.innerHTML = '✨ Google Gemini 추천 가이드';
        guideContent.innerHTML = `
          기존의 딱딱한 문체를 한국어 정서에 부합하는 가장 자연스러운 구어체/문어체로 구사하며, 자소서의 본인 핵심 에피소드를 문맥 속에 유기적으로 스며들게 녹여내는 자소서 작성용 최고의 AI입니다.<br/>
          <strong>추천 모델:</strong> <code style="background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">gemini-2.0-flash</code> (최고의 속도와 밸런스) 또는 <code style="background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">gemini-2.0-pro</code> (더 깊은 추론과 입체적인 글쓰기)<br/>
          <strong style="color:#6d28d9; display:inline-block; margin-top:10px; margin-bottom: 4px;">🔑 API 키 발급 상세 절차 (무료 사용 가능):</strong>
          <ol style="margin: 0; padding-left: 18px; line-height: 1.6; font-size: 12.5px;">
            <li><a href="https://aistudio.google.com/" target="_blank" style="color: #6d28d9; font-weight: bold; text-decoration: underline;">Google AI Studio</a>에 Google 계정으로 로그인합니다.</li>
            <li>좌측 상단의 <strong>[Get API key]</strong> ➔ <strong>[Create API key]</strong> 버튼을 순서대로 클릭합니다.</li>
            <li>신용카드 등록이나 별도 과금 결제 없이 기본 무료 요금제(분당 최대 15회 요청 등) 한도 내에서 <strong>평생 무료</strong>로 자소서 교정 서비스를 활용하실 수 있습니다.</li>
          </ol>
        `;
      } else if (provider === 'nvidia') {
        modelInput.placeholder = 'meta/llama-3.3-70b-instruct (권장) 또는 nvidia/nemotron-mini-4b-instruct';
        modelHint.innerText = 'NVIDIA NIM API 카탈로그 내의 사용 가능한 모델명을 입력하세요.';
        
        guideDiv.style.backgroundColor = '#F5F5F5';
        guideDiv.style.border = '1px solid #E5E5E5';
        guideDiv.style.color = '#404040';
        guideTitle.innerHTML = '⚡ NVIDIA NIM (사용자 지정 키 연동) 가이드';
        guideContent.innerHTML = `
          NVIDIA NIM 카탈로그의 오픈소스 모델 중 다른 거대 인공지능(Llama-3.3-70B 등)을 수동 기재하여 연구용으로 연동할 때 사용합니다.<br/>
          <strong>추천 모델:</strong> <code style="background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">meta/llama-3.3-70b-instruct</code> (NVIDIA NIM 제공 대형 모델)<br/>
          <strong style="color:#404040; display:inline-block; margin-top:10px; margin-bottom: 4px;">🔑 API 키 발급 상세 절차:</strong>
          <ol style="margin: 0; padding-left: 18px; line-height: 1.6; font-size: 12.5px;">
            <li><a href="https://build.nvidia.com/" target="_blank" style="color: #404040; font-weight: bold; text-decoration: underline;">NVIDIA NIM Catalog 사이트</a>에 로그인합니다.</li>
            <li>원하는 모델 상세 페이지에서 우측 상단의 <strong>[Get API Key]</strong>를 클릭해 발급하여 본인의 키를 입력합니다.</li>
          </ol>
        `;
      }
    }
  };

  providerSelect.addEventListener('change', updateModelPlaceholder);

  apiKeyInput.addEventListener('input', () => {
    const provider = providerSelect.value;
    if (provider !== 'default_nvidia') {
      savedKeys[provider] = apiKeyInput.value.trim();
    }
  });

  modelInput.addEventListener('input', () => {
    const provider = providerSelect.value;
    if (provider !== 'default_nvidia') {
      savedModels[provider] = modelInput.value.trim();
    }
  });

  // 저장된 설정 불러오기
  const saveHistoryCheckbox = document.getElementById('save-history-enabled');

  chrome.storage.local.get(['aiProvider', 'aiModel', 'apiKey', 'factProtectionPolicy', 'saveHistoryEnabled'], (res) => {
    // 기본제공사: default_nvidia
    if (res.aiProvider) {
      providerSelect.value = res.aiProvider;
    } else {
      providerSelect.value = 'default_nvidia';
    }
    
    // 기본모델 매핑
    if (res.aiModel) {
      savedModels[res.aiProvider || 'default_nvidia'] = res.aiModel;
    }

    // 내장 키 분기 캐싱 및 유효 수동 키 보존 매핑
    if (res.apiKey) {
      if (res.apiKey === DEFAULT_NVIDIA_KEY) {
        savedKeys[res.aiProvider || 'default_nvidia'] = MASKED_KEY_DUMMY;
      } else {
        savedKeys[res.aiProvider || 'default_nvidia'] = res.apiKey;
        // 기본 모델 모드에서도 사용자가 수동 저장해 둔 유효 키가 존재한다면 DUMMY 대신 그 키를 보존 매핑
        savedKeys.default_nvidia = res.apiKey;
      }
    }

    if (res.factProtectionPolicy !== undefined) {
      factPolicyInput.value = res.factProtectionPolicy;
    } else {
      factPolicyInput.value = `[사실 관계 보호 가드레일 활성화 ({{Fact_Protection_Lock}})]
- 입력 텍스트 내의 날짜, 연도, 회사명, 프로젝트명, 구체적인 수치(%, 점수, 금액 등)는 절대로 왜곡하거나 생략하지 않고 원본 그대로 보존해야 합니다.`;
    }

    if (res.saveHistoryEnabled !== undefined) {
      saveHistoryCheckbox.checked = res.saveHistoryEnabled;
    } else {
      saveHistoryCheckbox.checked = true; // 기본값 활성화
    }

    updateModelPlaceholder();
  });

  // 설정 저장
  btnSave.addEventListener('click', () => {
    const provider = providerSelect.value;
    const model = modelInput.value.trim();
    let apiKey = apiKeyInput.value.trim();
    const factPolicy = factPolicyInput.value;

    // 마스킹 DUMMY 문자 그대로 저장하거나 비어있으면 스토리지에는 내장 키로 대입
    if (apiKey === MASKED_KEY_DUMMY || !apiKey) {
      if (provider === 'default_nvidia' || provider === 'nvidia') {
        // 기존 스토리지에 사용자가 수동 저장한 유효 키가 있는지 먼저 검사하여 보존
        chrome.storage.local.get(['apiKey'], (storageRes) => {
          const existingKey = storageRes.apiKey;
          if (existingKey && existingKey !== DEFAULT_NVIDIA_KEY && existingKey !== MASKED_KEY_DUMMY && existingKey.trim() !== '') {
            apiKey = existingKey;
          } else {
            apiKey = DEFAULT_NVIDIA_KEY;
          }
          saveSettings(provider, model, apiKey, factPolicy);
        });
        return;
      } else if (!apiKey) {
        alert('API 키를 입력해주세요.');
        return;
      }
    }

    saveSettings(provider, model, apiKey, factPolicy);
  });

  function saveSettings(provider, model, apiKey, factPolicy) {
    // 기본 모델 자동 설정
    let finalModel = model;
    if (!finalModel || provider === 'default_nvidia') {
      if (provider === 'openai') finalModel = 'gpt-4o-mini';
      if (provider === 'gemini') finalModel = 'gemini-2.0-flash';
      if (provider === 'nvidia' || provider === 'default_nvidia') finalModel = 'nvidia/nemotron-mini-4b-instruct';
    }

    const saveHistory = saveHistoryCheckbox.checked;

    chrome.storage.local.set({
      aiProvider: provider,
      aiModel: finalModel,
      apiKey: apiKey,
      factProtectionPolicy: factPolicy,
      saveHistoryEnabled: saveHistory
    }, () => {
      statusMsg.className = 'status-msg status-success';
      statusMsg.innerText = '설정이 성공적으로 저장되었습니다!';
      statusMsg.style.display = 'block';

      setTimeout(() => {
        statusMsg.style.display = 'none';
      }, 2500);
    });
  }

  // 탭 전환 기능 바인딩 (Manifest V3 CSP 준수)
  const menuItems = document.querySelectorAll('.sidebar-menu-item');
  const panels = document.querySelectorAll('.tab-panel');

  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      
      menuItems.forEach(mi => mi.classList.remove('active'));
      panels.forEach(pan => pan.classList.remove('active'));

      item.classList.add('active');
      const activePanel = document.getElementById(targetId);
      if (activePanel) {
        activePanel.classList.add('active');
      }
    });
  });

  // FAQ 아코디언 핸들러
  const faqQuestions = document.querySelectorAll('.faq-question');
  faqQuestions.forEach(q => {
    q.addEventListener('click', () => {
      const item = q.parentElement;
      const answer = item.querySelector('.faq-answer');
      const isActive = item.classList.contains('active');
      
      if (isActive) {
        item.classList.remove('active');
        answer.style.display = 'none';
      } else {
        item.classList.add('active');
        answer.style.display = 'block';
      }
    });
  });
});
