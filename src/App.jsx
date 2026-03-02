import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Target, Briefcase, Plus, X, Search, ChevronUp, ChevronDown, BarChart3, PieChart as PieChartIcon, History, BookOpen, Star, AlertTriangle, Calendar, Edit2, Trash2, RefreshCw, Wifi, WifiOff, Settings } from 'lucide-react';

// ============ UTILITIES ============
const formatVND = (value) => {
  if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(2) + ' tỷ';
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(2) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value);
};

const formatPrice = (price) => new Intl.NumberFormat('vi-VN').format(price);

const formatDate = (date) => {
  const d = new Date(date);
  return d.toLocaleDateString('vi-VN');
};

// ============ PRICE API SERVICE ============
// Sử dụng API nội bộ với vnstock
const PriceAPI = {
  // Gọi API nội bộ (Vercel serverless function)
  async fetchPrices(symbols) {
    if (!symbols || symbols.length === 0) {
      return { success: false, error: 'Không có mã nào để cập nhật' };
    }
    
    try {
      const symbolStr = symbols.join(',');
      const apiUrl = `/api/price?symbols=${symbolStr}`;
      
      const res = await fetch(apiUrl);
      
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }
      
      const data = await res.json();
      
      if (data.success) {
        return { 
          success: true, 
          data: data.data,
          fetched: data.fetched || [],
          failed: data.failed || []
        };
      } else {
        return { 
          success: false, 
          error: data.error || 'Không lấy được dữ liệu' 
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

// ============ SAMPLE DATA ============
const initialTransactions = [];

const initialStocks = {};

const initialWatchlist = [];

const initialJournal = [];

// PnL history by month (sample)
const pnlHistory = [];

const SECTOR_COLORS = {
  'Tiêu dùng': '#10b981',
  'Công nghệ': '#6366f1',
  'Bất động sản': '#f59e0b',
  'Thép': '#64748b',
  'Bán lẻ': '#ec4899',
  'Ngân hàng': '#0ea5e9',
};

const CONCENTRATION_WARNING = 25; // Cảnh báo nếu 1 mã > 25%

// ============ MAIN COMPONENT ============
export default function StockTrackerPro() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const [transactions, setTransactions] = useState(initialTransactions);
  const [stocks, setStocks] = useState(initialStocks);
  const [watchlist, setWatchlist] = useState(initialWatchlist);
  const [journal, setJournal] = useState(initialJournal);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);
  const [pnlPeriod, setPnlPeriod] = useState('month');
  
  // Price update states
  const [isOnline, setIsOnline] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [editingPrice, setEditingPrice] = useState({ symbol: '', price: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  // Form states
  const [newTransaction, setNewTransaction] = useState({
    symbol: '', type: 'buy', date: new Date().toISOString().split('T')[0], price: '', shares: '', note: ''
  });
  const [newJournalEntry, setNewJournalEntry] = useState({ title: '', content: '', mood: 'neutral' });
  const [newWatchItem, setNewWatchItem] = useState({ symbol: '', name: '', sector: '', currentPrice: '', note: '' });

  // ============ COMPUTED VALUES ============
  
  // Calculate holdings from transactions
  const holdings = useMemo(() => {
    const holdingsMap = {};
    
    transactions.forEach(t => {
      if (!holdingsMap[t.symbol]) {
        holdingsMap[t.symbol] = { totalShares: 0, totalCost: 0, transactions: [] };
      }
      
      if (t.type === 'buy') {
        holdingsMap[t.symbol].totalShares += t.shares;
        holdingsMap[t.symbol].totalCost += t.price * t.shares;
      } else {
        holdingsMap[t.symbol].totalShares -= t.shares;
        // Reduce cost proportionally
        const avgCost = holdingsMap[t.symbol].totalCost / (holdingsMap[t.symbol].totalShares + t.shares);
        holdingsMap[t.symbol].totalCost -= avgCost * t.shares;
      }
      holdingsMap[t.symbol].transactions.push(t);
    });
    
    return Object.entries(holdingsMap)
      .filter(([_, data]) => data.totalShares > 0)
      .map(([symbol, data]) => ({
        symbol,
        ...stocks[symbol],
        shares: data.totalShares,
        avgPrice: Math.round(data.totalCost / data.totalShares),
        totalCost: data.totalCost,
        transactions: data.transactions,
      }));
  }, [transactions, stocks]);

  // Portfolio stats
  const portfolioStats = useMemo(() => {
    const totalInvested = holdings.reduce((sum, h) => sum + h.totalCost, 0);
    const totalValue = holdings.reduce((sum, h) => sum + h.currentPrice * h.shares, 0);
    const totalPnL = totalValue - totalInvested;
    const pnlPercent = totalInvested > 0 ? (totalPnL / totalInvested * 100) : 0;
    
    return { totalInvested, totalValue, totalPnL, pnlPercent };
  }, [holdings]);

  // Sector allocation
  const sectorAllocation = useMemo(() => {
    const sectors = {};
    const totalValue = holdings.reduce((sum, h) => sum + h.currentPrice * h.shares, 0);
    
    holdings.forEach(h => {
      if (!sectors[h.sector]) sectors[h.sector] = 0;
      sectors[h.sector] += h.currentPrice * h.shares;
    });
    
    return Object.entries(sectors).map(([name, value]) => ({
      name,
      value,
      percentage: totalValue > 0 ? (value / totalValue * 100) : 0,
      color: SECTOR_COLORS[name] || '#888',
    }));
  }, [holdings]);

  // Concentration warnings
  const concentrationWarnings = useMemo(() => {
    const totalValue = holdings.reduce((sum, h) => sum + h.currentPrice * h.shares, 0);
    return holdings
      .map(h => ({
        symbol: h.symbol,
        percentage: totalValue > 0 ? (h.currentPrice * h.shares / totalValue * 100) : 0,
      }))
      .filter(h => h.percentage > CONCENTRATION_WARNING);
  }, [holdings]);

  // ============ HANDLERS ============
  
  const addTransaction = () => {
    const newT = {
      id: Date.now(),
      symbol: newTransaction.symbol.toUpperCase(),
      type: newTransaction.type,
      date: newTransaction.date,
      price: parseFloat(newTransaction.price),
      shares: parseInt(newTransaction.shares),
      note: newTransaction.note,
    };
    
    // Add stock info if new
    if (!stocks[newT.symbol]) {
      setStocks(prev => ({
        ...prev,
        [newT.symbol]: {
          name: newTransaction.name || newT.symbol,
          sector: newTransaction.sector || 'Khác',
          currentPrice: newT.price,
          targetBuy: 0,
          targetSell: 0,
          priority: false,
        }
      }));
    }
    
    setTransactions([...transactions, newT]);
    setNewTransaction({ symbol: '', type: 'buy', date: new Date().toISOString().split('T')[0], price: '', shares: '', note: '' });
    setShowModal(null);
  };

  const addJournalEntry = () => {
    setJournal([{
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      ...newJournalEntry,
    }, ...journal]);
    setNewJournalEntry({ title: '', content: '', mood: 'neutral' });
    setShowModal(null);
  };

  const addWatchItem = () => {
    setWatchlist([...watchlist, {
      symbol: newWatchItem.symbol.toUpperCase(),
      name: newWatchItem.name,
      sector: newWatchItem.sector,
      currentPrice: parseFloat(newWatchItem.currentPrice),
      note: newWatchItem.note,
      priority: false,
    }]);
    setNewWatchItem({ symbol: '', name: '', sector: '', currentPrice: '', note: '' });
    setShowModal(null);
  };

  const togglePriority = (symbol, isWatchlist = false) => {
    if (isWatchlist) {
      setWatchlist(watchlist.map(w => 
        w.symbol === symbol ? { ...w, priority: !w.priority } : w
      ));
    } else {
      setStocks(prev => ({
        ...prev,
        [symbol]: { ...prev[symbol], priority: !prev[symbol].priority }
      }));
    }
  };

  const updateTargets = (symbol, targetBuy, targetSell) => {
    setStocks(prev => ({
      ...prev,
      [symbol]: { ...prev[symbol], targetBuy, targetSell }
    }));
  };

  const deleteTransaction = (id) => {
    setTransactions(transactions.filter(t => t.id !== id));
  };

  const deleteWatchItem = (symbol) => {
    setWatchlist(watchlist.filter(w => w.symbol !== symbol));
  };

  const deleteJournalEntry = (id) => {
    setJournal(journal.filter(j => j.id !== id));
  };

  // ============ PRICE UPDATE FUNCTIONS ============
  
  // Cập nhật giá thủ công cho 1 mã
  const updateSinglePrice = (symbol, newPrice) => {
    setStocks(prev => ({
      ...prev,
      [symbol]: { ...prev[symbol], currentPrice: parseFloat(newPrice) }
    }));
  };

  // Cập nhật giá thủ công cho watchlist
  const updateWatchlistPrice = (symbol, newPrice) => {
    setWatchlist(prev => prev.map(w => 
      w.symbol === symbol ? { ...w, currentPrice: parseFloat(newPrice) } : w
    ));
  };

  // Fetch giá từ API
  const refreshPrices = useCallback(async () => {
    setIsRefreshing(true);
    
    // Lấy tất cả symbols từ portfolio và watchlist
    const portfolioSymbols = Object.keys(stocks);
    const watchlistSymbols = watchlist.map(w => w.symbol);
    const allSymbols = [...new Set([...portfolioSymbols, ...watchlistSymbols])];
    
    // Nếu không có mã nào thì không fetch
    if (allSymbols.length === 0) {
      alert('⚠️ Chưa có mã nào trong danh mục hoặc tầm ngắm để cập nhật giá!');
      setIsRefreshing(false);
      return;
    }
    
    try {
      const result = await PriceAPI.fetchPrices(allSymbols);
      
      if (result.success && Object.keys(result.data).length > 0) {
        setIsOnline(true);
        
        // Update portfolio stocks
        setStocks(prev => {
          const updated = { ...prev };
          Object.keys(result.data).forEach(symbol => {
            if (updated[symbol]) {
              updated[symbol] = {
                ...updated[symbol],
                currentPrice: result.data[symbol].price,
                priceChange: result.data[symbol].change,
                volume: result.data[symbol].volume,
              };
            }
          });
          return updated;
        });
        
        // Update watchlist
        setWatchlist(prev => prev.map(w => {
          if (result.data[w.symbol]) {
            return {
              ...w,
              currentPrice: result.data[w.symbol].price,
              change: parseFloat(result.data[w.symbol].change),
            };
          }
          return w;
        }));
        
        setLastUpdated(new Date());
        
        let message = `✅ Đã cập nhật giá ${result.fetched?.length || Object.keys(result.data).length} mã thành công!`;
        if (result.failed && result.failed.length > 0) {
          message += `\n\n⚠️ Không lấy được: ${result.failed.join(', ')}`;
        }
        alert(message);
      } else {
        setIsOnline(false);
        alert(`❌ Không lấy được dữ liệu giá!\n\nLỗi: ${result.error || 'Không có dữ liệu trả về'}\n\nKiểm tra lại mã cổ phiếu hoặc thử lại sau.`);
      }
    } catch (error) {
      setIsOnline(false);
      alert(`❌ Lỗi kết nối API!\n\nChi tiết: ${error.message}\n\nHãy thử lại sau vài phút.`);
    }
    
    setIsRefreshing(false);
  }, [stocks, watchlist]);

  // Auto refresh effect
  useEffect(() => {
    if (autoRefresh && isOnline) {
      const interval = setInterval(refreshPrices, 60000); // Mỗi phút
      return () => clearInterval(interval);
    }
  }, [autoRefresh, isOnline, refreshPrices]);

  // Check connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await fetch('/api/price?symbols=VNM');
        if (res.ok) {
          const data = await res.json();
          setIsOnline(data.success);
        } else {
          setIsOnline(false);
        }
      } catch (err) {
        console.error('Connection check failed:', err);
        setIsOnline(false);
      }
    };
    checkConnection();
  }, []);

  // Filter
  const filteredHoldings = holdings.filter(h =>
    h.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
    h.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredWatchlist = watchlist.filter(w =>
    w.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-[#08080c] text-white" style={{ fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl" />
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '32px 32px'
        }} />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto p-4 md:p-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <BarChart3 className="w-5 h-5 text-black" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                <span className="text-emerald-400">Stock</span>Tracker
                <span className="text-xs ml-2 px-2 py-0.5 bg-violet-500/20 text-violet-400 rounded">PRO</span>
              </h1>
              <p className="text-xs text-white/30">Quản lý danh mục đầu tư cá nhân</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Connection status & Refresh */}
            <div className="flex items-center gap-1 px-2 py-1.5 bg-white/5 rounded-lg">
              {isOnline ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-white/30" />
              )}
              <span className="text-xs text-white/40 hidden sm:inline">
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            
            <button
              onClick={refreshPrices}
              disabled={isRefreshing}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isOnline 
                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' 
                  : 'bg-white/5 text-white/40'
              }`}
              title={lastUpdated ? `Cập nhật lúc: ${lastUpdated.toLocaleTimeString('vi-VN')}` : 'Chưa cập nhật'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isRefreshing ? 'Đang tải...' : 'Cập nhật giá'}</span>
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/70"
            >
              <Settings className="w-4 h-4" />
            </button>
            
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                type="text"
                placeholder="Tìm mã..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm w-36 md:w-48 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
        </header>

        {/* Concentration Warnings */}
        {concentrationWarnings.length > 0 && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="text-sm">
              <span className="text-amber-400 font-medium">Cảnh báo tập trung: </span>
              <span className="text-white/70">
                {concentrationWarnings.map(w => `${w.symbol} (${w.percentage.toFixed(1)}%)`).join(', ')} 
                {' '}chiếm &gt;{CONCENTRATION_WARNING}% danh mục
              </span>
            </div>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
            <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Tổng đầu tư</div>
            <div className="text-lg font-semibold">{formatVND(portfolioStats.totalInvested)}</div>
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
            <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Giá trị</div>
            <div className="text-lg font-semibold">{formatVND(portfolioStats.totalValue)}</div>
          </div>
          <div className={`border rounded-xl p-4 ${portfolioStats.totalPnL >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
            <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Lãi/Lỗ</div>
            <div className={`text-lg font-semibold flex items-center gap-1 ${portfolioStats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {portfolioStats.totalPnL >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {portfolioStats.totalPnL >= 0 ? '+' : ''}{formatVND(portfolioStats.totalPnL)}
            </div>
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
            <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Tỷ suất</div>
            <div className={`text-lg font-semibold ${portfolioStats.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {portfolioStats.pnlPercent >= 0 ? '+' : ''}{portfolioStats.pnlPercent.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-6 border-b border-white/5 pb-4">
          {[
            { id: 'portfolio', label: 'Danh mục', icon: Briefcase, count: holdings.length },
            { id: 'history', label: 'Lịch sử', icon: History },
            { id: 'analysis', label: 'Phân tích', icon: PieChartIcon },
            { id: 'watchlist', label: 'Tầm ngắm', icon: Target, count: watchlist.length },
            { id: 'journal', label: 'Nhật ký', icon: BookOpen, count: journal.length },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                activeTab === tab.id
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-white/50 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.count !== undefined && (
                <span className="text-xs opacity-60">({tab.count})</span>
              )}
            </button>
          ))}
          
          <div className="flex-1" />
          
          {/* Add buttons based on active tab */}
          {activeTab === 'portfolio' && (
            <button
              onClick={() => setShowModal('transaction')}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-medium rounded-lg text-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Giao dịch</span>
            </button>
          )}
          {activeTab === 'watchlist' && (
            <button
              onClick={() => setShowModal('watchlist')}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-medium rounded-lg text-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Thêm mã</span>
            </button>
          )}
          {activeTab === 'journal' && (
            <button
              onClick={() => setShowModal('journal')}
              className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-400 text-black font-medium rounded-lg text-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Viết nhật ký</span>
            </button>
          )}
        </div>

        {/* ============ PORTFOLIO TAB ============ */}
        {activeTab === 'portfolio' && (
          <div className="space-y-4">
            {filteredHoldings.map(holding => {
              const pnl = (holding.currentPrice - holding.avgPrice) * holding.shares;
              const pnlPercent = ((holding.currentPrice - holding.avgPrice) / holding.avgPrice * 100);
              const isProfit = pnl >= 0;
              const nearTarget = holding.targetSell > 0 && holding.currentPrice >= holding.targetSell * 0.95;
              const nearStop = holding.targetBuy > 0 && holding.currentPrice <= holding.targetBuy * 1.05;
              
              return (
                <div key={holding.symbol} className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden">
                  {/* Main row */}
                  <div className="p-4 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3 min-w-[140px]">
                      <button
                        onClick={() => togglePriority(holding.symbol)}
                        className={`p-1 rounded ${holding.priority ? 'text-amber-400' : 'text-white/20 hover:text-white/40'}`}
                      >
                        <Star className="w-4 h-4" fill={holding.priority ? 'currentColor' : 'none'} />
                      </button>
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          {holding.symbol}
                          {nearTarget && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Gần target</span>}
                          {nearStop && <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">Gần stop</span>}
                        </div>
                        <div className="text-xs text-white/40">{holding.name}</div>
                      </div>
                    </div>
                    
                    <div className="text-right min-w-[80px]">
                      <div className="text-xs text-white/40">KL</div>
                      <div className="font-medium">{holding.shares.toLocaleString()}</div>
                    </div>
                    
                    <div className="text-right min-w-[90px]">
                      <div className="text-xs text-white/40">Giá TB</div>
                      <div className="font-medium">{formatPrice(holding.avgPrice)}</div>
                    </div>
                    
                    <div className="text-right min-w-[90px]">
                      <div className="text-xs text-white/40">Giá hiện tại</div>
                      <div className="font-medium flex items-center justify-end gap-1">
                        {formatPrice(holding.currentPrice)}
                        <button
                          onClick={() => {
                            setEditingPrice({ symbol: holding.symbol, price: holding.currentPrice.toString(), type: 'portfolio' });
                            setShowPriceModal(true);
                          }}
                          className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white/60"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="text-right min-w-[100px]">
                      <div className="text-xs text-white/40">Lãi/Lỗ</div>
                      <div className={`font-medium ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}{formatVND(pnl)}
                      </div>
                    </div>
                    
                    <div className="min-w-[70px]">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                        isProfit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
                      </span>
                    </div>
                    
                    <div className="flex-1" />
                    
                    <button
                      onClick={() => setSelectedStock(selectedStock === holding.symbol ? null : holding.symbol)}
                      className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1"
                    >
                      {selectedStock === holding.symbol ? 'Ẩn' : 'Chi tiết'}
                      {selectedStock === holding.symbol ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                  
                  {/* Expanded detail */}
                  {selectedStock === holding.symbol && (
                    <div className="border-t border-white/5 p-4 bg-white/[0.01]">
                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Targets */}
                        <div>
                          <div className="text-xs text-white/40 uppercase tracking-wider mb-2">Mục tiêu giá</div>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="text-[10px] text-white/30">Cắt lỗ</label>
                              <input
                                type="number"
                                value={holding.targetBuy || ''}
                                onChange={(e) => updateTargets(holding.symbol, parseFloat(e.target.value) || 0, holding.targetSell)}
                                className="w-full bg-red-500/10 border border-red-500/20 rounded px-2 py-1 text-sm text-red-400"
                                placeholder="0"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="text-[10px] text-white/30">Chốt lời</label>
                              <input
                                type="number"
                                value={holding.targetSell || ''}
                                onChange={(e) => updateTargets(holding.symbol, holding.targetBuy, parseFloat(e.target.value) || 0)}
                                className="w-full bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1 text-sm text-emerald-400"
                                placeholder="0"
                              />
                            </div>
                          </div>
                        </div>
                        
                        {/* Recent transactions */}
                        <div>
                          <div className="text-xs text-white/40 uppercase tracking-wider mb-2">Lịch sử giao dịch</div>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {holding.transactions?.slice(-5).reverse().map(t => (
                              <div key={t.id} className="flex items-center gap-2 text-xs">
                                <span className={`px-1.5 py-0.5 rounded ${t.type === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                  {t.type === 'buy' ? 'MUA' : 'BÁN'}
                                </span>
                                <span className="text-white/50">{formatDate(t.date)}</span>
                                <span className="text-white/70">{t.shares} @ {formatPrice(t.price)}</span>
                                {t.note && <span className="text-white/30 truncate max-w-[100px]">- {t.note}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            
            {filteredHoldings.length === 0 && (
              <div className="text-center py-12 text-white/30">
                <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Chưa có mã nào trong danh mục</p>
              </div>
            )}
          </div>
        )}

        {/* ============ HISTORY TAB ============ */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-white/5">
                <h3 className="font-medium">Tất cả giao dịch</h3>
              </div>
              <div className="divide-y divide-white/5">
                {transactions.slice().reverse().map(t => (
                  <div key={t.id} className="p-4 flex items-center gap-4 hover:bg-white/[0.02]">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      t.type === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {t.type === 'buy' ? 'MUA' : 'BÁN'}
                    </span>
                    <div className="min-w-[60px] font-semibold">{t.symbol}</div>
                    <div className="text-white/50 text-sm min-w-[80px]">{formatDate(t.date)}</div>
                    <div className="text-sm">{t.shares.toLocaleString()} cổ phiếu</div>
                    <div className="text-sm">@ {formatPrice(t.price)}</div>
                    <div className="text-sm text-white/50">{formatVND(t.price * t.shares)}</div>
                    <div className="flex-1 text-sm text-white/40 truncate">{t.note}</div>
                    <button
                      onClick={() => deleteTransaction(t.id)}
                      className="p-1.5 rounded hover:bg-red-500/20 text-white/30 hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ============ ANALYSIS TAB ============ */}
        {activeTab === 'analysis' && (
          <div className="grid lg:grid-cols-2 gap-4">
            {/* PnL Chart */}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium">Lãi/Lỗ theo thời gian</h3>
                <div className="flex gap-1">
                  {['week', 'month', 'year'].map(p => (
                    <button
                      key={p}
                      onClick={() => setPnlPeriod(p)}
                      className={`px-2 py-1 rounded text-xs ${
                        pnlPeriod === p ? 'bg-emerald-500/20 text-emerald-400' : 'text-white/40 hover:text-white/60'
                      }`}
                    >
                      {p === 'week' ? 'Tuần' : p === 'month' ? 'Tháng' : 'Năm'}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={pnlHistory}>
                  <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatVND(v)} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                    labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
                    formatter={(value) => [formatVND(value), '']}
                  />
                  <Line type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Sector Allocation */}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
              <h3 className="font-medium mb-4">Phân bổ theo ngành</h3>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={150} height={150}>
                  <PieChart>
                    <Pie
                      data={sectorAllocation}
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {sectorAllocation.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {sectorAllocation.map(sector => (
                    <div key={sector.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded" style={{ background: sector.color }} />
                      <span className="text-sm text-white/70 flex-1">{sector.name}</span>
                      <span className="text-sm font-medium">{sector.percentage.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Performance by sector */}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 lg:col-span-2">
              <h3 className="font-medium mb-4">Hiệu suất theo ngành</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sectorAllocation.map(sector => {
                  const sectorHoldings = holdings.filter(h => h.sector === sector.name);
                  const invested = sectorHoldings.reduce((sum, h) => sum + h.totalCost, 0);
                  const current = sectorHoldings.reduce((sum, h) => sum + h.currentPrice * h.shares, 0);
                  const pnl = current - invested;
                  const pnlPercent = invested > 0 ? (pnl / invested * 100) : 0;
                  
                  return (
                    <div key={sector.name} className="bg-white/[0.02] rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: sector.color }} />
                        <span className="text-sm font-medium">{sector.name}</span>
                      </div>
                      <div className="flex items-end justify-between">
                        <span className="text-xs text-white/40">{formatVND(current)}</span>
                        <span className={`text-sm font-medium ${pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ============ WATCHLIST TAB ============ */}
        {activeTab === 'watchlist' && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWatchlist.map(stock => (
              <div key={stock.symbol} className="bg-white/[0.02] border border-white/5 rounded-xl p-4 hover:border-white/10 transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => togglePriority(stock.symbol, true)}
                      className={`p-1 rounded ${stock.priority ? 'text-amber-400' : 'text-white/20 hover:text-white/40'}`}
                    >
                      <Star className="w-4 h-4" fill={stock.priority ? 'currentColor' : 'none'} />
                    </button>
                    <div>
                      <div className="font-semibold">{stock.symbol}</div>
                      <div className="text-xs text-white/40">{stock.name}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteWatchItem(stock.symbol)}
                    className="p-1.5 rounded hover:bg-red-500/20 text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="text-2xl font-semibold mb-2 flex items-center gap-2">
                  {formatPrice(stock.currentPrice)}
                  <button
                    onClick={() => {
                      setEditingPrice({ symbol: stock.symbol, price: stock.currentPrice.toString(), type: 'watchlist' });
                      setShowPriceModal(true);
                    }}
                    className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white/60"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                
                {stock.note && (
                  <div className="text-sm text-white/50 mb-3">{stock.note}</div>
                )}
                
                <div className="flex items-center justify-between">
                  <span className="text-xs px-2 py-1 rounded bg-white/5 text-white/40">{stock.sector}</span>
                  <button
                    onClick={() => {
                      setNewTransaction({
                        symbol: stock.symbol,
                        type: 'buy',
                        date: new Date().toISOString().split('T')[0],
                        price: stock.currentPrice.toString(),
                        shares: '',
                        note: '',
                        name: stock.name,
                        sector: stock.sector,
                      });
                      setShowModal('transaction');
                    }}
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Mua
                  </button>
                </div>
              </div>
            ))}
            
            {filteredWatchlist.length === 0 && (
              <div className="sm:col-span-2 lg:col-span-3 text-center py-12 text-white/30">
                <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Chưa có mã nào trong tầm ngắm</p>
              </div>
            )}
          </div>
        )}

        {/* ============ JOURNAL TAB ============ */}
        {activeTab === 'journal' && (
          <div className="space-y-4">
            {journal.map(entry => (
              <div key={entry.id} className={`bg-white/[0.02] border rounded-xl p-4 ${
                entry.mood === 'positive' ? 'border-emerald-500/20' :
                entry.mood === 'negative' ? 'border-red-500/20' : 'border-white/5'
              }`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-medium">{entry.title}</h4>
                    <div className="text-xs text-white/40 flex items-center gap-2 mt-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(entry.date)}
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        entry.mood === 'positive' ? 'bg-emerald-500/20 text-emerald-400' :
                        entry.mood === 'negative' ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/50'
                      }`}>
                        {entry.mood === 'positive' ? '😊 Tích cực' : entry.mood === 'negative' ? '😔 Tiêu cực' : '😐 Bình thường'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteJournalEntry(entry.id)}
                    className="p-1.5 rounded hover:bg-red-500/20 text-white/20 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-white/70 whitespace-pre-wrap">{entry.content}</p>
              </div>
            ))}
            
            {journal.length === 0 && (
              <div className="text-center py-12 text-white/30">
                <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Chưa có nhật ký nào</p>
              </div>
            )}
          </div>
        )}

        {/* ============ MODALS ============ */}
        
        {/* Transaction Modal */}
        {showModal === 'transaction' && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#12121a] border border-white/10 rounded-2xl w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h3 className="font-semibold">Thêm giao dịch</h3>
                <button onClick={() => setShowModal(null)} className="p-2 rounded-lg hover:bg-white/10 text-white/50">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 space-y-4">
                <div className="flex gap-2">
                  {['buy', 'sell'].map(type => (
                    <button
                      key={type}
                      onClick={() => setNewTransaction({ ...newTransaction, type })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                        newTransaction.type === type
                          ? type === 'buy' ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'
                          : 'bg-white/5 text-white/50 hover:bg-white/10'
                      }`}
                    >
                      {type === 'buy' ? 'MUA' : 'BÁN'}
                    </button>
                  ))}
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/40 uppercase">Mã CK</label>
                    <input
                      type="text"
                      value={newTransaction.symbol}
                      onChange={(e) => setNewTransaction({ ...newTransaction, symbol: e.target.value })}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
                      placeholder="VNM"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 uppercase">Ngày</label>
                    <input
                      type="date"
                      value={newTransaction.date}
                      onChange={(e) => setNewTransaction({ ...newTransaction, date: e.target.value })}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/40 uppercase">Giá</label>
                    <input
                      type="number"
                      value={newTransaction.price}
                      onChange={(e) => setNewTransaction({ ...newTransaction, price: e.target.value })}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
                      placeholder="75000"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 uppercase">Khối lượng</label>
                    <input
                      type="number"
                      value={newTransaction.shares}
                      onChange={(e) => setNewTransaction({ ...newTransaction, shares: e.target.value })}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
                      placeholder="500"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="text-xs text-white/40 uppercase">Ghi chú</label>
                  <textarea
                    value={newTransaction.note}
                    onChange={(e) => setNewTransaction({ ...newTransaction, note: e.target.value })}
                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 resize-none"
                    rows={2}
                    placeholder="Lý do mua/bán..."
                  />
                </div>
              </div>
              
              <div className="p-4 border-t border-white/5 flex gap-3">
                <button
                  onClick={() => setShowModal(null)}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium"
                >
                  Hủy
                </button>
                <button
                  onClick={addTransaction}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${
                    newTransaction.type === 'buy'
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                      : 'bg-red-500 hover:bg-red-400 text-white'
                  }`}
                >
                  {newTransaction.type === 'buy' ? 'Xác nhận MUA' : 'Xác nhận BÁN'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Watchlist Modal */}
        {showModal === 'watchlist' && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#12121a] border border-white/10 rounded-2xl w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h3 className="font-semibold">Thêm vào tầm ngắm</h3>
                <button onClick={() => setShowModal(null)} className="p-2 rounded-lg hover:bg-white/10 text-white/50">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/40 uppercase">Mã CK</label>
                    <input
                      type="text"
                      value={newWatchItem.symbol}
                      onChange={(e) => setNewWatchItem({ ...newWatchItem, symbol: e.target.value })}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50"
                      placeholder="TCB"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 uppercase">Ngành</label>
                    <input
                      type="text"
                      value={newWatchItem.sector}
                      onChange={(e) => setNewWatchItem({ ...newWatchItem, sector: e.target.value })}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50"
                      placeholder="Ngân hàng"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="text-xs text-white/40 uppercase">Tên công ty</label>
                  <input
                    type="text"
                    value={newWatchItem.name}
                    onChange={(e) => setNewWatchItem({ ...newWatchItem, name: e.target.value })}
                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50"
                    placeholder="Techcombank"
                  />
                </div>
                
                <div>
                  <label className="text-xs text-white/40 uppercase">Giá hiện tại</label>
                  <input
                    type="number"
                    value={newWatchItem.currentPrice}
                    onChange={(e) => setNewWatchItem({ ...newWatchItem, currentPrice: e.target.value })}
                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50"
                    placeholder="35000"
                  />
                </div>
                
                <div>
                  <label className="text-xs text-white/40 uppercase">Ghi chú</label>
                  <textarea
                    value={newWatchItem.note}
                    onChange={(e) => setNewWatchItem({ ...newWatchItem, note: e.target.value })}
                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50 resize-none"
                    rows={2}
                    placeholder="Điều kiện vào lệnh..."
                  />
                </div>
              </div>
              
              <div className="p-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowModal(null)} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium">
                  Hủy
                </button>
                <button onClick={addWatchItem} className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-lg text-sm font-medium">
                  Thêm vào tầm ngắm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Journal Modal */}
        {showModal === 'journal' && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#12121a] border border-white/10 rounded-2xl w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h3 className="font-semibold">Viết nhật ký</h3>
                <button onClick={() => setShowModal(null)} className="p-2 rounded-lg hover:bg-white/10 text-white/50">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs text-white/40 uppercase">Tiêu đề</label>
                  <input
                    type="text"
                    value={newJournalEntry.title}
                    onChange={(e) => setNewJournalEntry({ ...newJournalEntry, title: e.target.value })}
                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                    placeholder="Bài học hôm nay..."
                  />
                </div>
                
                <div>
                  <label className="text-xs text-white/40 uppercase">Tâm trạng</label>
                  <div className="flex gap-2 mt-1">
                    {[
                      { value: 'positive', label: '😊 Tích cực', color: 'emerald' },
                      { value: 'neutral', label: '😐 Bình thường', color: 'gray' },
                      { value: 'negative', label: '😔 Tiêu cực', color: 'red' },
                    ].map(m => (
                      <button
                        key={m.value}
                        onClick={() => setNewJournalEntry({ ...newJournalEntry, mood: m.value })}
                        className={`flex-1 py-2 rounded-lg text-xs transition-all ${
                          newJournalEntry.mood === m.value
                            ? m.color === 'emerald' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : m.color === 'red' ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-white/10 text-white/70 border border-white/20'
                            : 'bg-white/5 text-white/40 border border-transparent hover:bg-white/10'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div>
                  <label className="text-xs text-white/40 uppercase">Nội dung</label>
                  <textarea
                    value={newJournalEntry.content}
                    onChange={(e) => setNewJournalEntry({ ...newJournalEntry, content: e.target.value })}
                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50 resize-none"
                    rows={5}
                    placeholder="Hôm nay tôi học được rằng..."
                  />
                </div>
              </div>
              
              <div className="p-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowModal(null)} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium">
                  Hủy
                </button>
                <button onClick={addJournalEntry} className="flex-1 py-2.5 bg-violet-500 hover:bg-violet-400 text-white rounded-lg text-sm font-medium">
                  Lưu nhật ký
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Price Edit Modal */}
        {showPriceModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#12121a] border border-white/10 rounded-2xl w-full max-w-sm">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h3 className="font-semibold">Cập nhật giá {editingPrice.symbol}</h3>
                <button onClick={() => setShowPriceModal(false)} className="p-2 rounded-lg hover:bg-white/10 text-white/50">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4">
                <label className="text-xs text-white/40 uppercase">Giá mới (VNĐ)</label>
                <input
                  type="number"
                  value={editingPrice.price}
                  onChange={(e) => setEditingPrice({ ...editingPrice, price: e.target.value })}
                  className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-3 text-lg font-medium focus:outline-none focus:border-emerald-500/50"
                  placeholder="75000"
                  autoFocus
                />
                <p className="text-xs text-white/30 mt-2">
                  Nhập giá hiện tại của cổ phiếu (đơn vị: đồng)
                </p>
              </div>
              
              <div className="p-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowPriceModal(false)} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium">
                  Hủy
                </button>
                <button 
                  onClick={() => {
                    if (editingPrice.type === 'portfolio') {
                      updateSinglePrice(editingPrice.symbol, editingPrice.price);
                    } else {
                      updateWatchlistPrice(editingPrice.symbol, editingPrice.price);
                    }
                    setShowPriceModal(false);
                  }}
                  className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-lg text-sm font-medium"
                >
                  Cập nhật
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Settings Modal */}
        {showSettings && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#12121a] border border-white/10 rounded-2xl w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h3 className="font-semibold">Cài đặt</h3>
                <button onClick={() => setShowSettings(false)} className="p-2 rounded-lg hover:bg-white/10 text-white/50">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 space-y-4">
                {/* Connection Status */}
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                  <div className="flex items-center gap-2">
                    {isOnline ? (
                      <Wifi className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-red-400" />
                    )}
                    <span className="text-sm">Trạng thái API</span>
                  </div>
                  <span className={`text-sm font-medium ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isOnline ? 'Hoạt động' : 'Không khả dụng'}
                  </span>
                </div>

                {/* Data Source Info */}
                <div className="p-3 bg-white/5 rounded-lg">
                  <div className="text-sm font-medium mb-1">Nguồn dữ liệu</div>
                  <div className="text-xs text-white/50">vnstock (TCBS) - Dữ liệu realtime chứng khoán Việt Nam</div>
                </div>

                {/* Auto Refresh */}
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                  <div>
                    <div className="text-sm">Tự động cập nhật</div>
                    <div className="text-xs text-white/40">Mỗi phút khi online</div>
                  </div>
                  <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    className={`w-12 h-6 rounded-full transition-all ${
                      autoRefresh ? 'bg-emerald-500' : 'bg-white/20'
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      autoRefresh ? 'translate-x-6' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>

                {/* Last Updated */}
                {lastUpdated && (
                  <div className="text-xs text-white/40 text-center">
                    Cập nhật lần cuối: {lastUpdated.toLocaleString('vi-VN')}
                  </div>
                )}

                {/* Instructions */}
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <div className="text-xs text-emerald-400 font-medium mb-1">✨ Hướng dẫn</div>
                  <div className="text-xs text-white/50 space-y-1">
                    <p>• Thêm mã vào Danh mục hoặc Tầm ngắm</p>
                    <p>• Click "Cập nhật giá" để lấy giá mới nhất</p>
                    <p>• Hoặc click icon ✏️ để nhập giá thủ công</p>
                  </div>
                </div>
              </div>
              
              <div className="p-4 border-t border-white/5">
                <button onClick={() => setShowSettings(false)} className="w-full py-2.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium">
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-8 text-center text-white/20 text-xs">
          <p>Stock Tracker Pro · Quản lý danh mục đầu tư cá nhân</p>
        </footer>
      </div>
    </div>
  );
}
