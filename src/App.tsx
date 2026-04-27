import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { PlusCircle, TrendingUp, TrendingDown, Wallet, LogOut, Eye, FileText, Search, Calendar, Package, ChevronRight } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Transaction {
  id: string;
  date: string;
  due_date: string;
  type: 'INCOME' | 'EXPENSE';
  category: string;
  amount: number;
  description: string;
  status: 'PAID' | 'PENDING';
  voucher_url?: string;
}

interface Category {
  id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
}

const App = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [balance, setBalance] = useState({ income: 0, expense: 0, total: 0, pending: 0, initial: 0 });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<{username: string, role: string} | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

  // Filtros
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  
  // Estado do Formulário
  const [formData, setFormData] = useState<Partial<Transaction>>({
    type: 'EXPENSE',
    status: 'PAID',
    amount: 0,
    date: new Date().toISOString().slice(0, 10),
    due_date: new Date().toISOString().slice(0, 10),
    description: '',
    category: ''
  });
  
  const [newCat, setNewCat] = useState({ name: '', type: 'EXPENSE' });
  const [importedData, setImportedData] = useState<any[]>([]);

  useEffect(() => {
    if (isLoggedIn) {
      fetchTransactions();
      fetchCategories();
    }
  }, [selectedMonth, startDateFilter, endDateFilter, selectedCategory, typeFilter, search, isLoggedIn]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const users = [
      { username: 'office', password: '@820439', role: 'Escritório' },
      { username: 'financeiro', password: 'ACICG820439', role: 'Financeiro' }
    ];

    const found = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
    if (found) {
      setUser({ username: found.username, role: found.role });
      setIsLoggedIn(true);
    } else {
      alert("Usuário ou senha inválidos!");
    }
  };

  const fetchCategories = async () => {
    const { data } = await supabase.from('categories').select('*').order('name');
    if (data) setCategories(data);
  };

  const getDates = () => {
    const start = `${selectedMonth}-01`;
    const end = new Date(Number(selectedMonth.split('-')[0]), Number(selectedMonth.split('-')[1]), 0).toISOString().slice(0, 10);
    return { startDate: start, endDate: end };
  };

  const fetchTransactions = async () => {
    const { startDate, endDate } = getDates();

    try {
      // 1. Calcular Saldo Inicial (Transporte de TODOS os meses anteriores)
      // O saldo inicial é a soma de TUDO o que foi pago (PAID) antes do início deste mês
      const { data: prevData, error: prevError } = await supabase
        .from('transactions')
        .select('amount, type')
        .lt('date', startDate)
        .eq('status', 'PAID');
      
      if (prevError) throw prevError;

      let initial = 0;
      prevData?.forEach(t => {
        if (t.type === 'INCOME') initial += Number(t.amount);
        else initial -= Number(t.amount);
      });

      // 2. Buscar lançamentos do período (Pagos ou Pendentes)
      const sDate = startDateFilter || startDate;
      const eDate = endDateFilter || endDate;

      let query = supabase
        .from('transactions')
        .select('*')
        .or(`and(date.gte.${sDate},date.lte.${eDate}),and(due_date.gte.${sDate},due_date.lte.${eDate})`);
      
      if (selectedCategory !== 'ALL') query = query.eq('category', selectedCategory);
      if (typeFilter !== 'ALL') query = query.eq('type', typeFilter);
      if (search) query = query.ilike('description', `%${search}%`);

      const { data, error } = await query.order('date', { ascending: true });
      
      if (error) throw error;

      if (data) {
        setTransactions(data);
        
        // Receitas Pagas (afetam o saldo real)
        const income = data
          .filter(t => t.type === 'INCOME' && t.status === 'PAID')
          .reduce((acc, t) => acc + Number(t.amount), 0);
          
        // Despesas Pagas (afetam o saldo real)
        const expense = data
          .filter(t => t.type === 'EXPENSE' && t.status === 'PAID')
          .reduce((acc, t) => acc + Number(t.amount), 0);
          
        // Contas a Pagar (Futuras - não afetam o saldo bancário ainda)
        const pending = data
          .filter(t => t.type === 'EXPENSE' && t.status === 'PENDING')
          .reduce((acc, t) => acc + Number(t.amount), 0);
        
        setBalance({ 
          income, 
          expense, 
          initial,
          total: initial + income - expense, // Saldo Final Real
          pending 
        });
      }
    } catch (err: any) {
      console.error("Erro na busca:", err.message);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const dataToSave = { ...formData };
    
    // Ajustes de integridade
    if (dataToSave.status === 'PENDING' && !dataToSave.date) {
      dataToSave.date = dataToSave.due_date; // Se pendente e sem data de pgto, usa vencimento
    }

    try {
      if ((dataToSave as any).id) {
        const { error } = await supabase.from('transactions').update(dataToSave).eq('id', (dataToSave as any).id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('transactions').insert([dataToSave]);
        if (error) throw error;
      }
      setIsModalOpen(false);
      resetForm();
      fetchTransactions();
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Deseja realmente excluir este lançamento?")) {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (!error) fetchTransactions();
    }
  };

  const handleEdit = (t: Transaction) => {
    setFormData(t);
    setIsModalOpen(true);
  };

  const resetForm = () => {
    setFormData({
      type: 'EXPENSE',
      status: 'PAID',
      amount: 0,
      date: new Date().toISOString().slice(0, 10),
      due_date: new Date().toISOString().slice(0, 10),
      description: '',
      category: ''
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('vouchers')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('vouchers').getPublicUrl(fileName);
      setFormData({ ...formData, voucher_url: data.publicUrl });
    } catch (err: any) {
      alert("Erro upload: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleLiquidate = async (t: Transaction) => {
    const paymentDate = prompt("Data em que foi pago (AAAA-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!paymentDate) return;

    const { error } = await supabase
      .from('transactions')
      .update({ status: 'PAID', date: paymentDate })
      .eq('id', t.id);

    if (!error) fetchTransactions();
  };

  const handleOFXImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const parsed: any[] = [];
      const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
      let match;

      while ((match = trnRegex.exec(content)) !== null) {
        const block = match[1];
        const dateMatch = /<DTPOSTED>(\d{8})/.exec(block);
        const amountMatch = /<TRNAMT>([\d.-]+)/.exec(block);
        const memoMatch = /<MEMO>(.*)/.exec(block);
        
        if (dateMatch && amountMatch) {
          const rawDate = dateMatch[1];
          const formattedDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
          const amount = parseFloat(amountMatch[1]);
          parsed.push({
            date: formattedDate,
            amount: Math.abs(amount),
            type: amount > 0 ? 'INCOME' : 'EXPENSE',
            description: memoMatch ? memoMatch[1].trim() : 'Importado OFX',
            status: 'PAID',
            category: 'Outros'
          });
        }
      }
      setImportedData(parsed);
      setIsImportModalOpen(true);
    };
    reader.readAsText(file);
  };

  const saveImported = async () => {
    const { error } = await supabase.from('transactions').insert(importedData);
    if (!error) {
      setIsImportModalOpen(false);
      fetchTransactions();
      alert("Importação concluída!");
    }
  };

  const handleEditInitialBalance = async () => {
    // Busca o lançamento de Saldo Inicial mais recente no banco
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('category', 'Saldo Inicial')
      .order('date', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      handleEdit(data[0]);
    } else {
      // Se não houver, prepara um novo lançamento de abertura
      resetForm();
      setFormData({
        ...formData,
        type: 'INCOME',
        category: 'Saldo Inicial',
        description: 'Saldo Inicial do Sistema',
        status: 'PAID',
        date: new Date().toISOString().slice(0, 10),
        due_date: new Date().toISOString().slice(0, 10)
      });
      setIsModalOpen(true);
    }
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const { startDate, endDate } = getDates();
    
    // Layout do Extrato
    doc.setFontSize(18);
    doc.setTextColor(16, 185, 129);
    doc.text('ASSOCIACAO COMERCIAL E INDUSTRIAL DE CAPIM GROSSO - Extrato Bancário', 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Período Selecionado: ${startDate} a ${endDate}`, 14, 28);
    doc.text(`Data de Emissão: ${new Date().toLocaleString('pt-BR')}`, 14, 33);

    // Bloco de Resumo Financeiro
    doc.setFillColor(248, 250, 252);
    doc.rect(14, 38, 182, 35, 'F');
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    doc.text('Abertura do Período:', 20, 45);
    doc.text(`R$ ${balance.initial.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 70, 45);
    
    doc.text('Total de Entradas:', 20, 52);
    doc.text(`R$ ${balance.income.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 70, 52);
    
    doc.text('Total de Saídas:', 20, 59);
    doc.text(`R$ ${balance.expense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 70, 59);

    doc.setFont('helvetica', 'bold');
    doc.text('SALDO FINAL REAL:', 130, 55);
    doc.text(`R$ ${balance.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 165, 55);

    // Tabela de Movimentações
    let currentBalance = balance.initial;
    const tableRows = transactions
      .filter(t => t.status === 'PAID')
      .map(t => {
        const amt = Number(t.amount);
        if (t.type === 'INCOME') currentBalance += amt;
        else currentBalance -= amt;
        
        return [
          new Date(t.date).toLocaleDateString('pt-BR'),
          t.description,
          t.category,
          t.type === 'INCOME' ? `R$ ${amt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '',
          t.type === 'EXPENSE' ? `R$ ${amt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '',
          `R$ ${currentBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        ];
      });

    // Adiciona a linha final de fechamento na tabela
    tableRows.push([
      '',
      'FECHAMENTO - SALDO FINAL REAL',
      '',
      '',
      '',
      `R$ ${balance.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ]);

    autoTable(doc, {
      startY: 80,
      head: [['Data', 'Descrição', 'Categoria', 'Crédito', 'Débito', 'Saldo Acum.']],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], halign: 'center' },
      columnStyles: {
        3: { textColor: [16, 185, 129], halign: 'right' },
        4: { textColor: [239, 68, 68], halign: 'right' },
        5: { fontStyle: 'bold', halign: 'right' }
      },
      styles: { fontSize: 8 }
    });

    // Rodapé de Assinatura
    const finalY = (doc as any).lastAutoTable.finalY + 25;
    if (finalY < 270) {
      doc.setDrawColor(200);
      doc.line(14, finalY, 100, finalY);
      doc.text('Responsável Financeiro - ASSOCIACAO COMERCIAL E INDUSTRIAL DE CAPIM GROSSO', 14, finalY + 5);
    }

    doc.save(`Extrato_financeiro_${selectedMonth}.pdf`);
  };

  const handleExportPayables = () => {
    const doc = new jsPDF();
    const { startDate, endDate } = getDates();
    const sDate = startDateFilter || startDate;
    const eDate = endDateFilter || endDate;
    
    doc.setFontSize(18);
    doc.setTextColor(245, 158, 11); // Laranja para Contas a Pagar
    doc.text('ASSOCIACAO COMERCIAL E INDUSTRIAL DE CAPIM GROSSO - Relatório de Contas a Pagar', 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Previsão de Vencimentos: ${sDate} a ${eDate}`, 14, 28);
    doc.text(`Emissão: ${new Date().toLocaleString('pt-BR')}`, 14, 33);

    // Filtra apenas Pendentes (Contas a Pagar)
    const payables = transactions.filter(t => t.status === 'PENDING');
    const totalToPay = payables.reduce((acc, t) => acc + Number(t.amount), 0);

    const tableRows = payables.map(t => [
      new Date(t.due_date).toLocaleDateString('pt-BR'),
      t.description,
      t.category,
      `R$ ${Number(t.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ]);

    tableRows.push([
      '',
      '',
      'TOTAL PREVISTO:',
      `R$ ${totalToPay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ]);

    autoTable(doc, {
      startY: 40,
      head: [['Vencimento', 'Descrição', 'Categoria', 'Valor']],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [245, 158, 11] },
      columnStyles: {
        3: { fontStyle: 'bold', halign: 'right' }
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 20;
    doc.text('Relatório oficial de contas futuras agendadas.', 14, finalY);

    doc.save(`Contas_a_Pagar_${sDate}_a_${eDate}.pdf`);
  };

  if (!isLoggedIn) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', padding: '2rem' }}>
        <div className="card" style={{ width: '100%', maxWidth: '400px', textAlign: 'center', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
          <h1 style={{ color: 'var(--primary)', marginBottom: '0.5rem', fontWeight: 800, fontSize: '2rem' }}>ACICG CAPIM GROSSO</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>Acesso Restrito</p>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input 
              type="text" 
              placeholder="Usuário" 
              className="btn" 
              style={{ width: '100%', background: '#1e293b', textAlign: 'left', border: '1px solid rgba(255,255,255,0.1)' }}
              value={loginForm.username}
              onChange={e => setLoginForm({...loginForm, username: e.target.value})}
              required
            />
            <input 
              type="password" 
              placeholder="Senha" 
              className="btn" 
              style={{ width: '100%', background: '#1e293b', textAlign: 'left', border: '1px solid rgba(255,255,255,0.1)' }}
              value={loginForm.password}
              onChange={e => setLoginForm({...loginForm, password: e.target.value})}
              required
            />
            <button type="submit" className="btn" style={{ background: 'var(--primary)', color: 'white', fontWeight: 700, marginTop: '1rem', padding: '1rem' }}>
              ENTRAR NO SISTEMA
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <header className="main-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2.2rem', color: 'var(--primary)', display: 'flex', gap: '0.8rem', alignItems: 'center', fontWeight: 800 }}>
            <Wallet size={36} /> ACICG Capim Grosso
          </h1>
          <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginTop: '0.5rem' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Associação Comercial e Industrial</p>
            {user && <span style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>{user.role}</span>}
          </div>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={handleExportPayables} className="btn" style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)', border: '1px solid var(--warning)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Calendar size={18} /> Contas a Pagar
          </button>
          <button onClick={handleExportPDF} className="btn" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--primary)', border: '1px solid var(--primary)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <FileText size={18} /> Exportar Extrato
          </button>
          <button onClick={() => { setIsLoggedIn(false); setUser(null); }} className="btn" style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* BARRA DE FILTROS */}
      <section className="filters-bar" style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="date-filter" style={{ flex: 1, minWidth: '150px' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>MÊS REFERÊNCIA</label>
          <input type="month" value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); setStartDateFilter(''); setEndDateFilter(''); }} className="btn" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }} />
        </div>

        <div className="date-filter" style={{ flex: 1, minWidth: '150px' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>INÍCIO PERÍODO</label>
          <input type="date" value={startDateFilter} onChange={e => setStartDateFilter(e.target.value)} className="btn" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }} />
        </div>

        <div className="date-filter" style={{ flex: 1, minWidth: '150px' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>FIM PERÍODO</label>
          <input type="date" value={endDateFilter} onChange={e => setEndDateFilter(e.target.value)} className="btn" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }} />
        </div>
        
        <div style={{ flex: 1, minWidth: '150px' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>FLUXO</label>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="btn" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}>
            <option value="ALL">Todo Fluxo</option>
            <option value="INCOME">Entradas (+)</option>
            <option value="EXPENSE">Saídas (-)</option>
          </select>
        </div>

        <div style={{ flex: 1, minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>CATEGORIA</label>
          <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className="btn" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}>
            <option value="ALL">Todas Categorias</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        <div style={{ flex: 2, minWidth: '250px' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>PESQUISAR</label>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Buscar por descrição..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '0.6rem 0.6rem 0.6rem 2.8rem', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.6rem', color: 'white' }} />
          </div>
        </div>
        
        <button onClick={() => setIsCatModalOpen(true)} className="btn" style={{ background: '#334155', display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1.2rem', padding: '0.7rem 1rem' }}>
          <Package size={18} /> Categorias
        </button>
      </section>

      {/* DASHBOARD CARDS */}
      <section className="dashboard-grid">
        <div className="card" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.05) 100%)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'var(--primary)' }}>
            <Wallet size={24} /> <span style={{ fontWeight: 700, fontSize: '0.8rem', letterSpacing: '1px' }}>SALDO EM CAIXA REAL</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', marginTop: '1rem', fontWeight: 800 }}>R$ {balance.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.8rem', alignItems: 'center' }}>
            <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              Transportado:
              <button onClick={handleEditInitialBalance} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0 }} title="Ajustar Saldo de Abertura">
                <FileText size={14} />
              </button>
            </span>
            <span style={{ fontWeight: 600 }}>R$ {balance.initial.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
        
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'var(--primary)' }}>
            <TrendingUp size={24} /> <span style={{ fontWeight: 700, fontSize: '0.8rem', letterSpacing: '1px' }}>RECEITAS (LIQUIDADAS)</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', marginTop: '1rem', fontWeight: 800 }} className="amount-positive">R$ {balance.income.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem' }}>Entradas confirmadas no mês</p>
        </div>
        
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'var(--danger)' }}>
            <TrendingDown size={24} /> <span style={{ fontWeight: 700, fontSize: '0.8rem', letterSpacing: '1px' }}>DESPESAS (PAGAS)</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', marginTop: '1rem', fontWeight: 800 }} className="amount-negative">R$ {balance.expense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem' }}>Saídas confirmadas no mês</p>
        </div>
        
        <div className="card" style={{ background: 'rgba(245, 158, 11, 0.05)', borderLeft: '5px solid var(--warning)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'var(--warning)' }}>
            <Calendar size={24} /> <span style={{ fontWeight: 700, fontSize: '0.8rem', letterSpacing: '1px' }}>CONTAS A PAGAR</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', marginTop: '1rem', fontWeight: 800 }} className="amount-warning">R$ {balance.pending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem' }}>Saídas previstas (sem baixa)</p>
        </div>
      </section>

      {/* TABLE HEADER ACTIONS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h3 style={{ fontSize: '1.4rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <ChevronRight size={24} color="var(--primary)" /> Lançamentos do Período
        </h3>
        <div style={{ display: 'flex', gap: '0.8rem' }}>
          <label className="btn" style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer' }}>
            <PlusCircle size={18} /> Importar OFX
            <input type="file" onChange={handleOFXImport} style={{ display: 'none' }} accept=".ofx" />
          </label>
          <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="btn" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.8rem 1.5rem', background: 'var(--primary)', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)' }}>
            <PlusCircle size={20} /> NOVO LANÇAMENTO
          </button>
        </div>
      </div>

      {/* TRANSACTIONS TABLE */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)', background: '#0f172a' }}>
        <div className="table-responsive">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', textAlign: 'left' }}>
                <th style={{ padding: '1.2rem', color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '1px' }}>DATA</th>
                <th style={{ padding: '1.2rem', color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '1px' }}>DESCRIÇÃO</th>
                <th style={{ padding: '1.2rem', color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '1px' }}>CATEGORIA</th>
                <th style={{ padding: '1.2rem', color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '1px', textAlign: 'center' }}>STATUS</th>
                <th style={{ padding: '1.2rem', color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '1px', textAlign: 'right' }}>VALOR</th>
                <th style={{ padding: '1.2rem', color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '1px', textAlign: 'center' }}>ANEXO</th>
                <th style={{ padding: '1.2rem', color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '1px', textAlign: 'center' }}>AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-muted)' }}>
                    <Search size={48} style={{ marginBottom: '1rem', opacity: 0.2 }} />
                    <p>Nenhum registro encontrado para este filtro.</p>
                  </td>
                </tr>
              ) : (
                transactions.map(t => (
                  <tr key={t.id} style={{ borderTop: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.2s' }} className="table-row-hover">
                    <td style={{ padding: '1.2rem' }}>
                      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                        <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.5rem' }}>
                          <Calendar size={16} color="var(--primary)" />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                            {new Date((t.status === 'PAID' ? t.date : t.due_date) as string).toLocaleDateString('pt-BR')}
                          </span>
                          {t.status === 'PENDING' && <span style={{ fontSize: '0.65rem', color: 'var(--warning)', fontWeight: 700 }}>PREVISTO</span>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '1.2rem', fontSize: '0.95rem', fontWeight: 500 }}>{t.description}</td>
                    <td style={{ padding: '1.2rem' }}>
                      <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.06)', padding: '0.3rem 0.7rem', borderRadius: '0.5rem', color: 'rgba(255,255,255,0.8)' }}>
                        {t.category}
                      </span>
                    </td>
                    <td style={{ padding: '1.2rem', textAlign: 'center' }}>
                      <span style={{ 
                        fontSize: '0.65rem', 
                        padding: '0.3rem 0.8rem', 
                        borderRadius: '2rem', 
                        fontWeight: 800,
                        background: t.status === 'PAID' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                        color: t.status === 'PAID' ? 'var(--primary)' : 'var(--warning)',
                        border: `1px solid ${t.status === 'PAID' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
                        letterSpacing: '0.5px'
                      }}>
                        {t.status === 'PAID' ? 'LIQUIDADO' : 'PENDENTE'}
                      </span>
                    </td>
                    <td style={{ padding: '1.2rem', textAlign: 'right', fontWeight: 800, fontSize: '1rem' }} className={t.type === 'INCOME' ? 'amount-positive' : 'amount-negative'}>
                      {t.type === 'INCOME' ? '+' : '-'} R$ {Number(t.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '1.2rem', textAlign: 'center' }}>
                      {t.voucher_url ? (
                        <a href={t.voucher_url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', padding: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '0.5rem', display: 'inline-flex' }}>
                          <Eye size={18} />
                        </a>
                      ) : (
                        <span style={{ color: 'rgba(255,255,255,0.05)' }}>--</span>
                      )}
                    </td>
                    <td style={{ padding: '1.2rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                        {t.status === 'PENDING' && (
                          <button onClick={() => handleLiquidate(t)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }} title="Confirmar Pagamento">
                            <PlusCircle size={20} />
                          </button>
                        )}
                        <button onClick={() => handleEdit(t)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.4 }} title="Editar">
                          <FileText size={18} />
                        </button>
                        <button onClick={() => handleDelete(t.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', opacity: 0.4 }} title="Excluir">
                          <LogOut size={18} style={{ transform: 'rotate(90deg)' }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: NOVO/EDITAR LANÇAMENTO */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2, 6, 23, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }}>
          <div className="card" style={{ width: '480px', maxWidth: '90%', background: '#1e293b', padding: '2rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
              <div>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{(formData as any).id ? 'Editar Registro' : 'Novo Registro'}</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Preencha os dados do lançamento financeiro</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', background: '#0f172a', padding: '0.4rem', borderRadius: '1rem' }}>
                <button type="button" onClick={() => setFormData({...formData, type: 'INCOME', status: 'PAID'})} style={{ flex: 1, padding: '0.8rem', borderRadius: '0.7rem', border: 'none', background: formData.type === 'INCOME' ? 'var(--primary)' : 'transparent', color: 'white', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>ENTRADA</button>
                <button type="button" onClick={() => setFormData({...formData, type: 'EXPENSE'})} style={{ flex: 1, padding: '0.8rem', borderRadius: '0.7rem', border: 'none', background: formData.type === 'EXPENSE' ? 'var(--danger)' : 'transparent', color: 'white', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>SAÍDA</button>
              </div>

              {formData.type === 'EXPENSE' && (
                <div style={{ display: 'flex', background: '#334155', padding: '0.3rem', borderRadius: '0.8rem' }}>
                  <button type="button" onClick={() => setFormData({...formData, status: 'PAID'})} style={{ flex: 1, padding: '0.5rem', borderRadius: '0.6rem', border: 'none', background: formData.status === 'PAID' ? '#0f172a' : 'transparent', color: 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>JÁ FOI PAGO</button>
                  <button type="button" onClick={() => setFormData({...formData, status: 'PENDING'})} style={{ flex: 1, padding: '0.5rem', borderRadius: '0.6rem', border: 'none', background: formData.status === 'PENDING' ? '#0f172a' : 'transparent', color: 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>AGENDADO (A PAGAR)</button>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>DATA {formData.status === 'PAID' ? 'PAGAM.' : 'VENCIM.'}</label>
                  <input type="date" value={formData.status === 'PAID' ? formData.date : formData.due_date} onChange={e => setFormData({...formData, [formData.status === 'PAID' ? 'date' : 'due_date']: e.target.value})} style={{ padding: '0.9rem', background: '#0f172a', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.8rem' }} required />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>VALOR (R$)</label>
                  <input type="number" step="0.01" placeholder="0,00" value={formData.amount} onChange={e => setFormData({...formData, amount: parseFloat(e.target.value) || 0})} style={{ padding: '0.9rem', background: '#0f172a', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.8rem', fontWeight: 800 }} required />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>DESCRIÇÃO</label>
                <input type="text" placeholder="Ex: Pagamento Copel" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} style={{ padding: '0.9rem', background: '#0f172a', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.8rem' }} required />
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>CATEGORIA</label>
                <select 
                  value={formData.category} 
                  onChange={e => setFormData({...formData, category: e.target.value})}
                  style={{ padding: '0.9rem', background: '#0f172a', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.8rem' }}
                  required
                >
                  <option value="">Selecione...</option>
                  {categories.filter(c => c.type === formData.type).map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                  <option value="Outros">Outros</option>
                  <option value="Saldo Inicial">Saldo Inicial</option>
                </select>
              </div>
              
              <div style={{ border: '2px dashed rgba(255,255,255,0.1)', padding: '1.5rem', borderRadius: '1rem', textAlign: 'center', background: 'rgba(15, 23, 42, 0.5)' }}>
                <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
                  <Eye size={24} color="var(--primary)" />
                  <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                    {isUploading ? 'Enviando arquivo...' : formData.voucher_url ? 'Comprovante anexado ✓' : 'Anexar comprovante ou arquivo'}
                  </span>
                  <input type="file" onChange={handleFileUpload} style={{ display: 'none' }} accept="image/*,application/pdf" />
                </label>
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }} className="btn" style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)' }}>CANCELAR</button>
                <button type="submit" className="btn" style={{ flex: 2, background: 'var(--primary)', fontWeight: 800 }} disabled={isUploading}>SALVAR LANÇAMENTO</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: GERENCIAR CATEGORIAS */}
      {isCatModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2, 6, 23, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, backdropFilter: 'blur(8px)' }}>
          <div className="card" style={{ width: '420px', background: '#1e293b', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, fontWeight: 800 }}>Categorias</h3>
              <button onClick={() => setIsCatModalOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
            </div>
            
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {categories.map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: '#0f172a', borderRadius: '0.8rem' }}>
                  <span style={{ fontWeight: 500 }}>{c.name}</span>
                  <span style={{ fontSize: '0.6rem', padding: '0.3rem 0.7rem', borderRadius: '1rem', fontWeight: 800, background: c.type === 'INCOME' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: c.type === 'INCOME' ? 'var(--primary)' : 'var(--danger)' }}>
                    {c.type === 'INCOME' ? 'RECEITA' : 'DESPESA'}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '1px' }}>NOVA CATEGORIA</p>
              <input type="text" placeholder="Nome (Ex: Doações)" value={newCat.name} onChange={e => setNewCat({...newCat, name: e.target.value})} style={{ padding: '0.9rem', background: '#1e293b', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.8rem' }} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" onClick={() => setNewCat({...newCat, type: 'INCOME'})} style={{ flex: 1, padding: '0.6rem', borderRadius: '0.6rem', border: 'none', background: newCat.type === 'INCOME' ? 'var(--primary)' : '#334155', color: 'white', fontWeight: 700 }}>Receita</button>
                <button type="button" onClick={() => setNewCat({...newCat, type: 'EXPENSE'})} style={{ flex: 1, padding: '0.6rem', borderRadius: '0.6rem', border: 'none', background: newCat.type === 'EXPENSE' ? 'var(--danger)' : '#334155', color: 'white', fontWeight: 700 }}>Despesa</button>
              </div>
              <button className="btn" style={{ background: 'var(--primary)', fontWeight: 800, marginTop: '0.5rem' }} onClick={async () => {
                if(!newCat.name) return;
                const { error } = await supabase.from('categories').insert([newCat]);
                if(!error) { setNewCat({ name: '', type: 'EXPENSE' }); fetchCategories(); }
              }}>ADICIONAR CATEGORIA</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: IMPORTAÇÃO DE CONFERÊNCIA */}
      {isImportModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2, 6, 23, 0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, backdropFilter: 'blur(10px)' }}>
          <div className="card" style={{ width: '900px', maxWidth: '95%', background: '#1e293b', padding: '2.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1.8rem', fontWeight: 800 }}>Conferir Importação</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Foram identificados {importedData.length} lançamentos no arquivo OFX.</p>
            
            <div style={{ maxHeight: '55vh', overflowY: 'auto', marginBottom: '2rem', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: '1rem' }}>DATA</th>
                    <th style={{ padding: '1rem' }}>DESCRIÇÃO</th>
                    <th style={{ padding: '1rem', textAlign: 'right' }}>VALOR</th>
                    <th style={{ padding: '1rem', textAlign: 'center' }}>TIPO</th>
                  </tr>
                </thead>
                <tbody>
                  {importedData.map((d, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '1.2rem' }}>{new Date(d.date).toLocaleDateString('pt-BR')}</td>
                      <td style={{ padding: '1.2rem', fontWeight: 500 }}>{d.description}</td>
                      <td style={{ padding: '1.2rem', textAlign: 'right', fontWeight: 800 }} className={d.type === 'INCOME' ? 'amount-positive' : 'amount-negative'}>R$ {d.amount?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '1.2rem', textAlign: 'center' }}>
                         <span style={{ fontSize: '0.6rem', padding: '0.3rem 0.6rem', borderRadius: '1rem', background: d.type === 'INCOME' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: d.type === 'INCOME' ? 'var(--primary)' : 'var(--danger)', fontWeight: 800 }}>{d.type === 'INCOME' ? 'CRÉDITO' : 'DÉBITO'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <button onClick={() => setIsImportModalOpen(false)} className="btn" style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 700 }}>DESCARTAR TUDO</button>
              <button onClick={saveImported} className="btn" style={{ flex: 2, background: 'var(--primary)', fontWeight: 800 }}>IMPORTAR LANÇAMENTOS NO SISTEMA</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
