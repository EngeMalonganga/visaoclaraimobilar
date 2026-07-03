// ============ SUPABASE CLIENT ============
const { createClient } = supabase
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)

// ============ STATE ============
let currentUser = null
let uploadedFiles = {}
let charts = {}

// ============ UTILITY ============
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className = 'toast ' + type + ' show'
  setTimeout(() => t.classList.remove('show'), 4000)
}

function showLoading(text = 'A carregar...') {
  document.getElementById('loading-text').textContent = text
  document.getElementById('loading-overlay').style.display = 'flex'
}

function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none'
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open')
  document.getElementById('sidebar-overlay').classList.toggle('open')
}

function shareLink() {
  const url = 'https://visaoclara-imobilar-qq7ahezix-visaoclaramobiliaria.vercel.app/'
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copiado! Partilhe com amigos.', 'success')
  }).catch(() => {
    showToast('Erro ao copiar. Copie manualmente: ' + url, 'info')
  })
}

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

// ============ AUTH ============
function showTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'))
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'))
  if (tab === 'login') {
    document.querySelector('.auth-tab:nth-child(1)').classList.add('active')
    document.getElementById('login-form').classList.add('active')
  } else {
    document.querySelector('.auth-tab:nth-child(2)').classList.add('active')
    document.getElementById('register-form').classList.add('active')
  }
}

async function login() {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value.trim()
  if (!email || !password) { showToast('Preencha todos os campos', 'error'); return }

  showLoading('A entrar...')
  let loginOk = false
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error) {
      const msg = error.message
      if (msg.includes('Email not confirmed') || msg.includes('email_not_confirmed')) {
        showToast('Email não confirmado. Verifique a sua caixa de entrada.', 'error')
      } else if (msg.includes('Invalid login credentials') || msg.includes('Invalid email') || msg.includes('invalido')) {
        showToast('Email ou senha incorretos.', 'error')
      } else {
        console.error('Login error:', msg)
        showToast('Erro ao entrar. Tente novamente.', 'error')
      }
      return
    }

    loginOk = true
    const { data: usuario, error: userErr } = await sb.from('usuarios').select('*').eq('id', data.user.id).maybeSingle()
    if (usuario) {
      currentUser = usuario
      showToast('Bem-vindo, ' + usuario.nome + '!', 'success')
    } else {
      if (userErr) console.warn('Erro ao buscar usuario:', userErr.message)
      currentUser = {
        id: data.user.id,
        email: data.user.email,
        nome: data.user.user_metadata?.nome || email.split('@')[0],
        telefone: data.user.user_metadata?.telefone || ''
      }
    }
  } catch (e) { console.error('Login exception:', e); showToast('Erro de ligação. Tente novamente.', 'error') }
  finally {
    hideLoading()
    if (loginOk) showNewApp()
  }
}

async function register() {
  const nome = document.getElementById('reg-nome').value.trim()
  const email = document.getElementById('reg-email').value.trim()
  const telefone = document.getElementById('reg-telefone').value.trim()
  const password = document.getElementById('reg-password').value.trim()
  if (!nome || !email || !telefone || !password) { showToast('Preencha todos os campos', 'error'); return }

  showLoading('A criar conta...')
  try {
    const { data: existing } = await sb.from('usuarios').select('id').eq('email', email).maybeSingle()
    if (existing) {
      showToast('Este email já está cadastrado. Faça login.', 'error')
      hideLoading()
      return
    }

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { nome, telefone } }
    })
    if (error) {
      if (error.message?.toLowerCase().includes('already') || error.message?.toLowerCase().includes('exist') || error.message?.toLowerCase().includes('registered')) {
        showToast('Este email já está cadastrado. Faça login.', 'error')
      } else {
        console.error('Register error:', error.message)
        showToast('Erro ao criar conta. Tente novamente.', 'error')
      }
      return
    }

    const userId = data.user.id

    if (!data.session) {
      // Tentar fazer login automaticamente (funciona se email ja confirmado pelo trigger)
      const { data: loginData, error: loginError } = await sb.auth.signInWithPassword({ email, password })
      if (loginData?.session) {
        currentUser = { id: loginData.user.id, nome, email, telefone }
        showToast('Conta criada com sucesso!', 'success')
        showNewApp()
        hideLoading()
        return
      }
      showToast('Conta criada! Confirme o email para entrar.', 'info')
      showTab('login')
      document.getElementById('login-email').value = email
      hideLoading()
      return
    }

    currentUser = { id: userId, nome, email, telefone }
    showToast('Conta criada com sucesso!', 'success')
    showNewApp()
  } catch (e) { console.error('Register exception:', e); showToast('Erro de ligação. Tente novamente.', 'error') }
  finally { hideLoading() }
}

async function logout() {
  await sb.auth.signOut()
  currentUser = null
  showToast('Sessão encerrada', 'info')
  showSection('auth-section')
  document.getElementById('login-email').value = ''
  document.getElementById('login-password').value = ''
}

// ============ DASHBOARD ============
async function showDashboard() {
  showSection('dashboard-section')
  document.querySelector('.topbar-title').textContent = 'Dashboard'
  if (currentUser) document.getElementById('user-name-display').textContent = currentUser.nome
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'))
  document.querySelector('.sidebar-item[data-section="dashboard"]')?.classList.add('active')
  await refreshDashboard()
}

async function refreshDashboard() {
  showLoading('A carregar dashboard...')
  try {
    let lista = []
    const { data: direct, error } = await sb
      .from('candidaturas')
      .select('*')
      .eq('usuario_id', currentUser.id)

    if (!error && direct) {
      lista = direct
    } else {
      console.warn('Direct select failed, trying RPC:', error?.message)
      const { data: rpcData, error: rpcErr } = await sb.rpc('listar_minhas_candidaturas', {
        p_usuario_id: currentUser.id
      })
      if (!rpcErr && rpcData) lista = rpcData
    }

    const total = lista.length
    const analise = lista.filter(c => c.status === 'Em analise' || c.status === 'Em Análise').length
    const aprovadas = lista.filter(c => c.status === 'Aprovada').length
    const rejeitadas = lista.filter(c => c.status === 'Rejeitada').length

    document.getElementById('stat-total').textContent = total
    document.getElementById('stat-analise').textContent = analise
    document.getElementById('stat-aprovadas').textContent = aprovadas
    document.getElementById('stat-rejeitadas').textContent = rejeitadas

    renderCharts(lista)
    renderTable(lista)
  } catch (e) { showToast('Erro ao carregar dados', 'error') }
  finally { hideLoading() }
}

function renderCharts(candidaturas) {
  const primary = '#20C997', accent = '#14A37F', secondary = '#0B6B5B'
  const colorsPie = [primary, accent, secondary, '#5EEAD4', '#99F6E4']

  const barCtx = document.getElementById('chartBar').getContext('2d')
  if (charts.bar) charts.bar.destroy()
  charts.bar = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: ['Em Análise', 'Aprovadas', 'Rejeitadas'],
      datasets: [{
        label: 'Candidaturas',
        data: [
          candidaturas.filter(c => c.status === 'Em analise' || c.status === 'Em Análise').length,
          candidaturas.filter(c => c.status === 'Aprovada').length,
          candidaturas.filter(c => c.status === 'Rejeitada').length
        ],
        backgroundColor: [primary, '#2ECC71', '#E74C3C'],
        borderRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } } } }
  })

  // Line Chart
  const lineCtx = document.getElementById('chartLine').getContext('2d')
  if (charts.line) charts.line.destroy()
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun']
  const monthlyCounts = months.map((_, i) => candidaturas.filter(c => {
    const d = new Date(c.data_submissao || c.created_at)
    return d.getMonth() + 1 === i + 1
  }).length)
  if (monthlyCounts.every(v => v === 0)) monthlyCounts[5] = candidaturas.length
  const maxVal = Math.max(...monthlyCounts, 1)
  charts.line = new Chart(lineCtx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'Candidaturas',
        data: monthlyCounts,
        borderColor: primary, backgroundColor: primary + '20',
        fill: true, tension: 0.4,
        pointBackgroundColor: primary, pointRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: maxVal + 1, ticks: { stepSize: 1, precision: 0 } } } }
  })

  // Pie Chart
  const pieCtx = document.getElementById('chartPie').getContext('2d')
  if (charts.pie) charts.pie.destroy()
  const tipos = ['Apartamento', 'Vivenda', 'Loja', 'Escritório', 'Terreno']
  const tipoCounts = tipos.map(t => candidaturas.filter(c => c.tipo_imovel === t).length)
  const hasData = tipoCounts.some(v => v > 0)
  charts.pie = new Chart(pieCtx, {
    type: 'doughnut',
    data: {
      labels: tipos,
      datasets: [{ data: hasData ? tipoCounts : [40, 25, 15, 12, 8], backgroundColor: colorsPie, borderWidth: 2, borderColor: '#fff' }]
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } } }
  })
}

function escapeHTML(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

function renderTable(candidaturas) {
  const tbody = document.getElementById('table-body')
  if (candidaturas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999">Nenhuma candidatura encontrada</td></tr>'
    return
  }
  const sorted = [...candidaturas].sort((a, b) => new Date(b.data_submissao || b.created_at) - new Date(a.data_submissao || a.created_at))
  tbody.innerHTML = sorted.map(c => {
    const statusClass = c.status === 'Aprovada' ? 'badge-success' : c.status === 'Rejeitada' ? 'badge-error' : 'badge-warning'
    return `<tr>
      <td><strong>${escapeHTML(c.numero_candidatura || c.id.slice(0, 8))}</strong></td>
      <td>${escapeHTML(c.tipo_imovel || '-')}</td>
      <td>${escapeHTML(c.localizacao_desejada || '-')}</td>
      <td>${escapeHTML(new Date(c.data_submissao || c.created_at).toLocaleDateString('pt-PT'))}</td>
      <td><span class="badge ${escapeHTML(statusClass)}">${escapeHTML(c.status)}</span></td>
    </tr>`
  }).join('')
}

// ============ APPLICATION FORM ============
function showNewApp() {
  document.querySelector('.topbar-title').textContent = 'ÁREA DO CANDIDATO'
  document.getElementById('f-email-cand').value = currentUser?.email || ''
  showSection('form-section')
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'))
  document.querySelector('.sidebar-item[data-section="form"]')?.classList.add('active')
}

// ============ PDF VIEWER ============
function openPDFViewer() {
  window.open('fotos.pdf', '_blank')
}

function getFormData() {
  const pretende = document.querySelector('input[name="pretende"]:checked')
  const tipoImovel = document.querySelector('input[name="tipo-imovel"]:checked')
  const quartos = document.querySelector('input[name="quartos"]:checked')
  const rendimento = document.querySelector('input[name="rendimento"]:checked')
  const telefone = document.getElementById('f-telefone').value.trim()
  if (telefone && !/^\+?\d{7,15}$/.test(telefone)) { showToast('Telefone inválido', 'error'); return null }
  return {
    nome: document.getElementById('f-nome').value.trim().slice(0, 100),
    nascimento: document.getElementById('f-nascimento').value,
    bi: document.getElementById('f-bi').value.trim().slice(0, 20),
    nif: document.getElementById('f-nif').value.trim().slice(0, 20),
    nacionalidade: document.getElementById('f-nacionalidade').value.trim().slice(0, 50) || 'Angolana',
    telefone: telefone,
    morada: document.getElementById('f-morada').value.trim().slice(0, 200),
    pretende: pretende ? pretende.value : '',
    tipoImovel: tipoImovel ? tipoImovel.value : '',
    localizacao: document.getElementById('f-localizacao').value.trim().slice(0, 100),
    quartos: quartos ? quartos.value : '',
    profissao: document.getElementById('f-profissao').value.trim().slice(0, 100),
    empresa: document.getElementById('f-empresa').value.trim().slice(0, 100),
    cargo: document.getElementById('f-cargo').value.trim().slice(0, 100),
    rendimento: rendimento ? rendimento.value : ''
  }
}

async function candidaturaDirect(d) {
  const { data: cand, error: candErr } = await sb.from('candidatos').insert({
    usuario_id: currentUser.id,
    nome_completo: d.nome,
    data_nascimento: d.nascimento || null,
    bi: d.bi || null,
    nif: d.nif || null,
    nacionalidade: d.nacionalidade || 'Angolana',
    morada: d.morada || null,
    telefone: d.telefone,
    email: currentUser.email
  }).select().single()

  if (candErr || !cand) throw new Error(candErr?.message || 'Erro ao criar candidato')

  const { data: c, error: e } = await sb.from('candidaturas').insert({
    usuario_id: currentUser.id,
    candidato_id: cand.id,
    tipo_operacao: d.pretende || 'Comprar',
    tipo_imovel: d.tipoImovel || 'Apartamento',
    localizacao_desejada: d.localizacao || null,
    quartos_desejados: d.quartos || null,
    profissao: d.profissao || null,
    empresa: d.empresa || null,
    cargo: d.cargo || null,
    rendimento: d.rendimento || null,
    observacoes: document.getElementById('f-observacoes').value.trim() || null,
    aceite_termos: true,
    status: 'Em analise'
  }).select().single()

  if (e) throw new Error(e.message)
  return { candidatura: c, candidato_id: cand.id }
}

async function candidaturaRPC(d) {
  const { data, error } = await sb.rpc('criar_candidatura_completa', {
    p_usuario_id: currentUser.id,
    p_nome: d.nome,
    p_data_nascimento: d.nascimento || null,
    p_bi: d.bi || null,
    p_nif: d.nif || null,
    p_nacionalidade: d.nacionalidade || 'Angolana',
    p_morada: d.morada || null,
    p_telefone: d.telefone,
    p_email: currentUser.email,
    p_tipo_operacao: d.pretende || 'Comprar',
    p_tipo_imovel: d.tipoImovel || 'Apartamento',
    p_localizacao_desejada: d.localizacao || null,
    p_quartos_desejados: d.quartos || null,
    p_profissao: d.profissao || null,
    p_empresa: d.empresa || null,
    p_cargo: d.cargo || null,
    p_rendimento: d.rendimento || null,
    p_observacoes: document.getElementById('f-observacoes').value.trim() || null
  })

  if (error) throw new Error(error.message)
  return {
    candidatura: { id: data.candidatura_id, numero_candidatura: data.numero },
    candidato_id: data.candidato_id
  }
}

async function submitApplication() {
  if (!document.getElementById('f-termos').checked) { showToast('Aceite os termos e condições', 'error'); return }
  if (!currentUser || !currentUser.id) { showToast('Sessão expirada, faça login novamente', 'error'); return }

  const d = getFormData()
  if (!d) return
  showLoading('A enviar candidatura...')

  try {
    let result
    try {
      result = await candidaturaRPC(d)
    } catch (rpcErr) {
      console.warn('RPC failed, trying direct insert:', rpcErr.message)
      result = await candidaturaDirect(d)
    }

    // Upload documentos
    const maxSize = 10 * 1024 * 1024
    const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf']
    const uploadAreas = document.querySelectorAll('.upload-area')
    for (const area of uploadAreas) {
      const input = area.querySelector('input[type="file"]')
      if (input && input.files.length > 0) {
        const file = input.files[0]
        if (file.size > maxSize) { showToast('Ficheiro muito grande (max 10MB)', 'error'); continue }
        if (!allowedTypes.includes(file.type)) { showToast('Tipo de ficheiro não permitido', 'error'); continue }
        const tipo = area.dataset.target
        const safeName = file.name.replace(/[/\\:;*?"<>|]/g, '_')
        const filePath = `candidaturas/${result.candidatura.id}/${tipo}/${safeName}`
        const { error: uploadErr } = await sb.storage.from('documentos').upload(filePath, file)
        if (uploadErr) {
          console.warn('Storage upload failed, saving without file:', uploadErr.message)
        }
        await sb.from('documentos').insert({
          candidatura_id: result.candidatura.id,
          candidato_id: result.candidato_id,
          tipo: tipo,
          nome_original: safeName,
          url_storage: uploadErr ? '' : `${CONFIG.SUPABASE_URL}/storage/v1/object/public/documentos/${filePath}`,
          bucket_path: uploadErr ? '' : filePath,
          mime_type: file.type,
          tamanho_bytes: file.size,
          status: 'pendente'
        })
      }
    }

    document.getElementById('success-number').textContent = 'Nº ' + (result.candidatura.numero_candidatura || result.candidatura.id.slice(0, 8).toUpperCase())
    document.getElementById('success-date').textContent = new Date().toLocaleDateString('pt-PT') + ' às ' + new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
    showSection('success-section')
  } catch (e) {
    console.error('Submit error:', e)
    showToast('Erro ao enviar candidatura. Tente novamente.', 'error')
  } finally { hideLoading() }
}

// ============ UPLOAD ============
document.addEventListener('click', function(e) {
  const area = e.target.closest('.upload-area')
  if (area) area.querySelector('input[type="file"]')?.click()
})

document.addEventListener('change', function(e) {
  const input = e.target.closest('.upload-area input[type="file"]')
  if (!input) return
  const area = input.closest('.upload-area')
  const target = area.dataset.target
  if (input.files.length > 0) {
    const file = input.files[0]
    uploadedFiles[target] = file.name
    area.classList.add('has-file')
    area.querySelector('p').textContent = '\u2713 ' + file.name
  }
})

document.addEventListener('dragover', function(e) {
  const area = e.target.closest('.upload-area')
  if (area) { e.preventDefault(); area.classList.add('dragover') }
})
document.addEventListener('dragleave', function(e) {
  const area = e.target.closest('.upload-area')
  if (area) area.classList.remove('dragover')
})
document.addEventListener('drop', function(e) {
  const area = e.target.closest('.upload-area')
  if (!area) return
  e.preventDefault()
  area.classList.remove('dragover')
  const files = e.dataTransfer.files
  if (files.length > 0) {
    const input = area.querySelector('input[type="file"]')
    const dt = new DataTransfer()
    dt.items.add(files[0])
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
})

// ============ INIT ============
;(async function init() {
  showLoading('A verificar sessão...')
  try {
    const { data: { session } } = await sb.auth.getSession()
    if (session?.user) {
      const u = session.user
      const { data: usuario, error: userErr } = await sb.from('usuarios').select('*').eq('id', u.id).maybeSingle()
      if (usuario) {
        currentUser = usuario
      } else {
        if (userErr) console.warn('Erro ao buscar usuario:', userErr.message)
        currentUser = {
          id: u.id,
          email: u.email,
          nome: u.user_metadata?.nome || u.email?.split('@')[0] || 'Cliente',
          telefone: u.user_metadata?.telefone || ''
        }
      }
      await showNewApp()
    } else {
      showSection('auth-section')
    }
  } catch (e) {
    console.error('Init error:', e)
    showSection('auth-section')
  }
  finally { hideLoading() }
})()
