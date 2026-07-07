// 김대필 (ContextWrite) Options Script

document.addEventListener('DOMContentLoaded', () => {
  const providerSelect = document.getElementById('ai-provider');
  const modelInput = document.getElementById('ai-model');
  const apiKeyInput = document.getElementById('api-key');
  const factPolicyInput = document.getElementById('fact-policy');
  const btnSave = document.getElementById('btn-save');
  const statusMsg = document.getElementById('status-msg');
  const modelHint = document.getElementById('model-hint');

  // 제공업체별 기본 추천 모델 힌트 제공 및 추천 가이드 업데이트
  const updateModelPlaceholder = () => {
    const provider = providerSelect.value;
    const guideDiv = document.getElementById('ai-recommendation-guide');
    const guideTitle = document.getElementById('rec-guide-title');
    const guideContent = document.getElementById('rec-guide-content');

    if (provider === 'simulation') {
      document.getElementById('model-group').style.display = 'none';
      document.getElementById('api-key-group').style.display = 'none';
      
      guideDiv.style.display = 'block';
      guideDiv.style.backgroundColor = '#EFF6FF';
      guideDiv.style.border = '1px solid #BFDBFE';
      guideDiv.style.color = '#1E3A8A';
      guideTitle.innerHTML = '💡 기본 로컬 시뮬레이터 안내';
      guideContent.innerHTML = '오프라인 시뮬레이션 모드입니다. 인터넷 연결 없이 무료로 빠르게 변환 성능을 테스트할 수 있습니다.<br/><span style="font-weight:600; color:#1E40AF;">추천:</span> 한 차원 높은 정밀한 자연화 및 완벽한 한국어 문맥 매칭을 원하신다면 <strong>OpenAI</strong> 또는 <strong>Google Gemini</strong> 연동을 권장합니다.';
    } else {
      document.getElementById('model-group').style.display = 'block';
      document.getElementById('api-key-group').style.display = 'block';
      guideDiv.style.display = 'block';
      
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
        
        guideDiv.style.backgroundColor = '#FDF2F8';
        guideDiv.style.border = '1px solid #FBCFE8';
        guideDiv.style.color = '#9D174D';
        guideTitle.innerHTML = '⚡ NVIDIA NIM API 추천 가이드';
        guideContent.innerHTML = `
          NVIDIA 카탈로그 내 최신 오픈소스 초거대 모델(LLM)을 연구/활용하고자 할 때 권장합니다.<br/>
          <strong>추천 모델:</strong> <code style="background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">meta/llama-3.3-70b-instruct</code> (최신 고성능 추론 모델) 또는 <code style="background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">nvidia/nemotron-mini-4b-instruct</code> (NVIDIA 튜닝 RAG/글쓰기 특화 모델)<br/>
          <strong style="color:#be185d; display:inline-block; margin-top:10px; margin-bottom: 4px;">🔑 API 키 발급 상세 절차:</strong>
          <ol style="margin: 0; padding-left: 18px; line-height: 1.6; font-size: 12.5px;">
            <li><a href="https://build.nvidia.com/" target="_blank" style="color: #be185d; font-weight: bold; text-decoration: underline;">NVIDIA NIM Catalog 사이트</a>에 로그인합니다.</li>
            <li>원하는 모델 상세 페이지로 진입하여 우측 상단의 <strong>[Get API Key]</strong> ➔ <strong>[Generate Key]</strong>를 클릭합니다.</li>
            <li>첫 가입 시 1,000회 내외로 무료 호출이 가능한 테스트 크레딧이 기본 제공되어 무료 체험이 가능합니다.</li>
          </ol>
        `;
      }
    }
  };

  providerSelect.addEventListener('change', updateModelPlaceholder);

  // 저장된 설정 불러오기
  const saveHistoryCheckbox = document.getElementById('save-history-enabled');

  chrome.storage.local.get(['aiProvider', 'aiModel', 'apiKey', 'factProtectionPolicy', 'saveHistoryEnabled'], (res) => {
    if (res.aiProvider) {
      providerSelect.value = res.aiProvider;
    } else {
      providerSelect.value = 'simulation';
    }
    
    if (res.aiModel) {
      modelInput.value = res.aiModel;
    } else {
      modelInput.value = '';
    }

    if (res.apiKey) {
      apiKeyInput.value = res.apiKey;
    } else {
      apiKeyInput.value = '';
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
    const apiKey = apiKeyInput.value.trim();
    const factPolicy = factPolicyInput.value;

    if (provider !== 'simulation' && !apiKey) {
      alert('API 키를 입력해주세요.');
      return;
    }

    // 기본 모델 자동 설정
    let finalModel = model;
    if (!finalModel && provider !== 'simulation') {
      if (provider === 'openai') finalModel = 'gpt-4o-mini';
      if (provider === 'gemini') finalModel = 'gemini-2.0-flash';
      if (provider === 'nvidia') finalModel = 'meta/llama-3.3-70b-instruct';
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
