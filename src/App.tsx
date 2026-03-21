import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Activity, 
  Settings, 
  History, 
  Play, 
  Square, 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  Zap,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Warehouse,
  Users,
  UserCog,
  MessageSquare,
  Eye,
  Briefcase,
  DollarSign,
  UserPlus,
  Heart,
  Shield,
  LogIn,
  LogOut,
  Flower2,
  Coins,
  Target,
  BarChart3,
  RefreshCw,
  Music,
  Volume2,
  VolumeX,
  Info,
  BookOpen
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  RoomState, 
  RoomStats, 
  BetRecord, 
  SelectionMode, 
  ROOM_NAMES, 
  ROOM_ORDER 
} from "./types";
import { chooseRoom, initFormulas, updateFormulasAfterResult, FORMULAS } from "./logic/formulas";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { auth, signInWithGoogle } from "./firebase";
import { onAuthStateChanged, User, signOut } from "firebase/auth";
import ReCAPTCHA from "react-google-recaptcha";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const WS_URL = "wss://api.escapemaster.net/escape_master/ws";

export default function App() {
  // Firebase Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Auth State
  const [loginLink, setLoginLink] = useState("");
  const [userId, setUserId] = useState<number | null>(null);
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<ReCAPTCHA>(null);

  // Game State
  const [issueId, setIssueId] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [killedRoom, setKilledRoom] = useState<number | null>(null);
  const [lastKilledRoom, setLastKilledRoom] = useState<number | null>(null);
  const [roomState, setRoomState] = useState<Record<number, RoomState>>({});
  const [roomStats, setRoomStats] = useState<Record<number, RoomStats>>(
    ROOM_ORDER.reduce((acc, r) => ({ ...acc, [r]: { kills: 0, survives: 0, lastKillRound: null, lastPlayers: 0, lastBet: 0 } }), {})
  );
  const [predictedRoom, setPredictedRoom] = useState<number | null>(null);
  const [uiState, setUiState] = useState<"IDLE" | "ANALYZING" | "PREDICTED" | "RESULT">("IDLE");
  const [logs, setLogs] = useState<{ id: number; time: string; msg: string; type: "info" | "success" | "error" | "warn" }[]>([]);

  // Balance State
  const [balances, setBalances] = useState({ build: 0, usdt: 0, world: 0 });
  const [cumulativeProfit, setCumulativeProfit] = useState(0);
  const [startingBalance, setStartingBalance] = useState<number | null>(null);

  // Betting State
  const [isRunning, setIsRunning] = useState(false);
  const [baseBet, setBaseBet] = useState(0);
  const [multiplier, setMultiplier] = useState(0);
  const [currentBet, setCurrentBet] = useState(0);
  const [algo, setAlgo] = useState<SelectionMode>("VIP50");
  const [betHistory, setBetHistory] = useState<BetRecord[]>([]);
  const [winStreak, setWinStreak] = useState(0);
  const [loseStreak, setLoseStreak] = useState(0);
  const [maxWinStreak, setMaxWinStreak] = useState(0);
  const [maxLoseStreak, setMaxLoseStreak] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Settings
  const [pauseAfterLosses, setPauseAfterLosses] = useState(0);
  const [skipRoundsRemaining, setSkipRoundsRemaining] = useState(0);
  const [maxBet, setMaxBet] = useState(1000);

  const wsRef = useRef<WebSocket | null>(null);
  const betSentForIssue = useRef<Set<number>>(new Set());
  const logIdCounter = useRef(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      await signInWithGoogle();
      addLog("Đăng nhập Google thành công", "success");
    } catch (e) {
      addLog("Lỗi đăng nhập Google", "error");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsLoggedIn(false);
      setUserId(null);
      setSecretKey(null);
      addLog("Đã đăng xuất", "info");
    } catch (e) {
      addLog("Lỗi đăng xuất", "error");
    }
  };

  const addLog = useCallback((msg: string, type: "info" | "success" | "error" | "warn" = "info") => {
    setLogs(prev => {
      // Avoid duplicate consecutive logs within a short time
      if (prev.length > 0 && prev[0].msg === msg) return prev;
      const id = ++logIdCounter.current;
      const time = new Date().toLocaleTimeString();
      return [{ id, time, msg, type }, ...prev].slice(0, 50);
    });
  }, []);

  // Helper to parse login link
  const handleLogin = () => {
    if (!loginLink) {
      addLog("⚠️ CẢNH BÁO BẢO MẬT: Bạn chưa nhập Link trò chơi!", "error");
      return;
    }
    
    if (!loginLink.includes("userId=") || !loginLink.includes("secretKey=")) {
      addLog("❌ LỖI NGHIÊM TRỌNG: Link trò chơi sai định dạng hoặc thiếu khóa bảo mật!", "error");
      return;
    }

    if (!captchaToken) {
      addLog("🛡️ BẢO MẬT: Vui lòng xác minh Captcha để tiếp tục!", "error");
      return;
    }
    setIsConnecting(true);
    try {
      const url = new URL(loginLink);
      const params = new URLSearchParams(url.search);
      const uid = params.get("userId");
      const secret = params.get("secretKey");
      if (uid && secret) {
        setUserId(parseInt(uid));
        setSecretKey(secret);
        setIsLoggedIn(true);
        initFormulas(algo);
        addLog("✅ XÁC THỰC THÀNH CÔNG: Hệ thống bảo mật đã kích hoạt!", "success");
      } else {
        addLog("❌ LỖI: Không thể trích xuất thông tin bảo mật từ Link!", "error");
      }
    } catch (e) {
      addLog("❌ LỖI: Link trò chơi không hợp lệ hoặc bị hỏng!", "error");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleToggleAuto = () => {
    if (!isLoggedIn) {
      handleLogin();
    } else {
      if (!isRunning) {
        if (baseBet <= 0) {
          addLog("⚠️ CẢNH BÁO: Cược cơ bản không được để trống hoặc bằng 0!", "error");
          return;
        }
        if (multiplier <= 0) {
          addLog("⚠️ CẢNH BÁO: Hệ số nhân (Multiplier) chưa được thiết lập!", "error");
          return;
        }
      }
      setIsRunning(!isRunning);
      addLog(isRunning ? "⏹️ ĐÃ DỪNG AUTO" : "🚀 BẮT ĐẦU AUTO - AI ĐANG QUÉT DỮ LIỆU", isRunning ? "warn" : "success");
    }
  };

  const toggleMusic = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(e => console.error("Audio play error:", e));
      }
      setIsPlaying(!isPlaying);
    }
  };

  const fetchBalances = useCallback(async () => {
    if (!userId || !secretKey) return;
    try {
      const response = await fetch("/api/proxy/wallet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "user-id": userId.toString(),
          "user-secret-key": secretKey
        },
        body: JSON.stringify({ user_id: userId, source: "home" })
      });
      
      const text = await response.text();
      if (!text) return;
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return;
      }
      
      // Robust parsing logic
      const d = data.data || data;
      const build = d.cwallet?.build || d.cwallet?.ctoken || d.cwallet?.amount || d.build || d.ctoken || d.balance || 0;
      const usdt = d.usdt || d.kusdt || d.usdt_balance || 0;
      const world = d.world || d.xworld || 0;

      setBalances({ build, usdt, world });
      
      if (startingBalance === null && build > 0) {
        setStartingBalance(build);
      } else if (startingBalance !== null) {
        setCumulativeProfit(build - startingBalance);
      }
    } catch (e) {
      console.error("Fetch balance error:", e);
    }
  }, [userId, secretKey, startingBalance]);

  const placeBet = async (issue: number, room: number, amount: number) => {
    if (!userId || !secretKey || betSentForIssue.current.has(issue)) return;
    
    if (amount > maxBet) {
      addLog(`Cược ${amount} vượt giới hạn ${maxBet}. Dừng cược.`, "warn");
      setIsRunning(false);
      return;
    }

    addLog(`Đang đặt cược ${amount} vào phòng ${ROOM_NAMES[room]}...`, "info");
    
    try {
      const response = await fetch("/api/proxy/bet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "user-id": userId.toString(),
          "user-secret-key": secretKey
        },
        body: JSON.stringify({
          asset_type: "BUILD",
          user_id: userId,
          room_id: room,
          bet_amount: amount
        })
      });
      
      const text = await response.text();
      if (!text) {
        addLog("Lỗi: Phản hồi cược trống", "error");
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        addLog("Lỗi: Không thể phân tích JSON cược", "error");
        return;
      }
      
      const record: BetRecord = {
        issue,
        room,
        amount,
        time: new Date().toLocaleTimeString(),
        result: "Đang",
        algo
      };

      if (data.msg === "ok" || data.code === 0) {
        betSentForIssue.current.add(issue);
        setBetHistory(prev => [...prev, record]);
        addLog(`Đặt cược thành công: ${amount} BUILD`, "success");
      } else {
        addLog(`Đặt cược thất bại: ${data.msg || data.message || "Lỗi không xác định"}`, "error");
      }
    } catch (e) {
      addLog(`Lỗi kết nối khi đặt cược: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  // WebSocket Connection
  useEffect(() => {
    if (!isLoggedIn) return;

    let heartbeatInterval: NodeJS.Timeout;
    let reconnectTimeout: NodeJS.Timeout;
    let isConnecting = false;

    const connectWs = () => {
      if (isConnecting || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) return;
      
      isConnecting = true;
      // Only log connection attempt if not already connecting
      addLog("Đang kết nối WebSocket...", "info");
      
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        isConnecting = false;
        addLog("Đã kết nối WebSocket", "success");
        ws.send(JSON.stringify({
          msg_type: "handle_enter_game",
          asset_type: "BUILD",
          user_id: userId,
          user_secret_key: secretKey
        }));

        // Heartbeat to keep connection alive
        heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ msg_type: "heartbeat" }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const msgType = data.msg_type || data.type;
        
        if (msgType === "notify_issue_stat") {
          const rooms = data.rooms || data.data?.rooms || [];
          const newState: Record<number, RoomState> = {};
          rooms.forEach((rm: any) => {
            const rid = rm.room_id || rm.roomId || rm.id;
            newState[rid] = {
              players: rm.user_cnt || rm.userCount || 0,
              bet: rm.total_bet_amount || rm.totalBet || 0
            };
          });
          setRoomState(newState);

          const newIssue = data.issue_id || data.data?.issue_id;
          if (newIssue && newIssue !== issueId) {
            addLog(`Phiên mới: ${newIssue}`, "info");
            setIssueId(newIssue);
            setKilledRoom(null);
            setPredictedRoom(null);
            setUiState("ANALYZING");
          }
        } else if (msgType === "notify_count_down") {
          const cd = data.count_down || data.countDown || data.count;
          setCountdown(cd);
          
          if (cd > 15 && uiState === "RESULT") {
            setUiState("ANALYZING");
          }

          if (cd <= 10 && (uiState === "ANALYZING" || uiState === "IDLE") && isRunning && issueId) {
            if (betSentForIssue.current.has(issueId)) return;

            if (skipRoundsRemaining > 0) {
              setSkipRoundsRemaining(prev => prev - 1);
              setUiState("IDLE");
              addLog(`Đang nghỉ: Còn ${skipRoundsRemaining} ván`, "warn");
              betSentForIssue.current.add(issueId); // Mark as handled for this issue
            } else {
              const { roomId } = chooseRoom(algo, roomState, roomStats, betHistory, lastKilledRoom, true);
              setPredictedRoom(roomId);
              setUiState("PREDICTED");
              addLog(`Dự đoán: Phòng ${ROOM_NAMES[roomId]}`, "info");
              placeBet(issueId, roomId, currentBet);
            }
          }
        } else if (msgType === "notify_result") {
          const kr = data.killed_room || data.data?.killed_room;
          const resultIssue = data.issue_id || data.data?.issue_id || issueId;
          
          if (kr !== undefined) {
            const krid = parseInt(kr);
            addLog(`Kết quả phiên ${resultIssue}: Sát thủ vào phòng ${ROOM_NAMES[krid]}`, "info");
            setKilledRoom(krid);
            setLastKilledRoom(krid);
            setRoomStats(prev => {
              const next = { ...prev };
              ROOM_ORDER.forEach(r => {
                if (r === krid) {
                  next[r].kills += 1;
                  next[r].lastKillRound = resultIssue;
                } else {
                  next[r].survives += 1;
                }
              });
              return next;
            });

            setBetHistory(prev => {
              const lastBet = prev.find(b => b.issue === resultIssue && !b.settled);
              if (lastBet) {
                const win = lastBet.room !== krid;
                lastBet.result = win ? "Thắng" : "Thua";
                lastBet.settled = true;
                lastBet.killedRoom = krid;
                
                if (win) {
                  addLog("Kết quả: THẮNG!", "success");
                  setWinStreak(s => s + 1);
                  setLoseStreak(0);
                  setMaxWinStreak(m => Math.max(m, winStreak + 1));
                  setCurrentBet(baseBet);
                } else {
                  addLog("Kết quả: THUA!", "error");
                  setLoseStreak(s => s + 1);
                  setWinStreak(0);
                  setMaxLoseStreak(m => Math.max(m, loseStreak + 1));
                  setCurrentBet(lastBet.amount * multiplier);
                  if (pauseAfterLosses > 0) setSkipRoundsRemaining(pauseAfterLosses);
                }
              }
              return [...prev];
            });

            updateFormulasAfterResult(predictedRoom, krid, algo, roomState, roomStats, betHistory, lastKilledRoom, true);
            fetchBalances();
          }
          setUiState("RESULT");
        }
      } catch (e) {
        console.error("WS Parse Error:", e);
      }
    };

      ws.onclose = () => {
        isConnecting = false;
        clearInterval(heartbeatInterval);
        addLog("Mất kết nối WebSocket. Đang thử lại...", "warn");
        reconnectTimeout = setTimeout(connectWs, 3000);
      };

      ws.onerror = () => {
        isConnecting = false;
        ws.close();
      };
    };

    connectWs();

    return () => {
      clearInterval(heartbeatInterval);
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [isLoggedIn, userId, secretKey, algo, isRunning, currentBet, baseBet, multiplier, pauseAfterLosses, skipRoundsRemaining, issueId, roomState, roomStats, betHistory, lastKilledRoom, fetchBalances, addLog, uiState, winStreak, loseStreak, predictedRoom]);

  // Balance Poller
  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = setInterval(fetchBalances, 5000);
    return () => clearInterval(interval);
  }, [isLoggedIn, fetchBalances]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-rose-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Flower2 className="w-12 h-12 text-rose-400 animate-spin" />
          <p className="text-rose-600 font-bold animate-pulse">ĐANG TẢI HỆ THỐNG...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#fff5f5] text-zinc-900 flex items-center justify-center p-4 font-sans relative overflow-hidden">
        <CherryBlossoms />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white border border-rose-100 rounded-[2rem] p-10 shadow-[0_20px_50px_rgba(244,63,94,0.1)] relative z-10"
        >
          <div className="flex flex-col items-center text-center mb-10">
            <div className="p-4 bg-rose-50 rounded-2xl mb-4">
              <Shield className="w-10 h-10 text-rose-500" />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-zinc-900 mb-1">VTH TOOL</h1>
            <p className="text-sm text-rose-400 font-bold uppercase tracking-widest">Premium AI System</p>
          </div>

          <div className="space-y-6">
            <p className="text-center text-zinc-500 text-sm px-4">Đăng nhập bằng Google để tiếp tục sử dụng hệ thống phân tích Escape Master.</p>
            
            <button 
              onClick={handleGoogleLogin}
              className="w-full bg-white hover:bg-zinc-50 text-zinc-700 border border-zinc-200 font-bold py-4 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-sm"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
              Tiếp tục với Google
            </button>
          </div>
          
          <div className="mt-10 pt-6 border-t border-zinc-50 text-center">
            <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">Copyright by GIA BẢO K24</p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#fff5f5] text-zinc-900 flex items-center justify-center p-4 font-sans relative overflow-hidden">
        <CherryBlossoms />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white border border-rose-100 rounded-[2rem] p-10 shadow-[0_20px_50px_rgba(244,63,94,0.1)] relative z-10"
        >
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <img src={user.photoURL || ""} className="w-10 h-10 rounded-full border-2 border-rose-200" alt="Avatar" />
              <div>
                <p className="text-xs font-bold text-zinc-400 uppercase">Chào mừng,</p>
                <p className="text-sm font-black text-zinc-800">{user.displayName}</p>
              </div>
            </div>
            <button onClick={handleLogout} className="p-2 hover:bg-rose-50 rounded-full text-rose-400 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-zinc-400 uppercase mb-2 ml-1 tracking-widest">Dán link trò chơi</label>
              <textarea 
                className="w-full bg-zinc-50 border border-zinc-100 rounded-2xl p-4 text-sm focus:border-rose-300 outline-none transition-all min-h-[120px] resize-none text-zinc-700 placeholder:text-zinc-300"
                placeholder="https://xworld.info/game/escape-master?userId=...&secretKey=..."
                value={loginLink}
                onChange={(e) => setLoginLink(e.target.value)}
              />
            </div>

            <div className="flex justify-center">
              <ReCAPTCHA
                ref={captchaRef}
                sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI" // Test key, replace with real one
                onChange={(token) => setCaptchaToken(token)}
              />
            </div>

            <button 
              onClick={handleLogin}
              disabled={isConnecting}
              className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-4 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-rose-500/20"
            >
              {isConnecting ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  KẾT NỐI HỆ THỐNG
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black font-sans p-2 md:p-4 selection:bg-rose-200 overflow-x-hidden relative">
      <CherryBlossoms />
      <audio 
        ref={audioRef} 
        src="https://files.catbox.moe/5yveay.mp3" 
        loop 
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ 
          duration: 1.2, 
          ease: [0.16, 1, 0.3, 1],
          opacity: { duration: 1 }
        }}
        className="max-w-[1000px] mx-auto space-y-6 relative z-10"
      >
        
        {/* Header & Info Bar */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 md:p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)] flex flex-col md:flex-row justify-between items-center gap-6 hover:shadow-[0_20px_60px_rgba(0,0,0,0.12)] transition-shadow duration-500">
          <div className="flex items-center gap-6">
            <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
              <Shield className="w-10 h-10 text-black" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tighter text-black">VTH TOOL</h1>
              <p className="text-[12px] text-zinc-500 font-black tracking-[0.2em] uppercase">Bản quyền by GIA BẢO K24</p>
            </div>
          </div>

          <div className="flex-1 flex flex-col md:flex-row gap-6 px-4">
            <div className="flex-1 bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
              <p className="text-[11px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1 mb-2">
                <BookOpen className="w-4 h-4" /> Hướng dẫn
              </p>
              <p className="text-[12px] text-zinc-700 leading-relaxed font-medium">
                1. Dán link game & login. 2. Chỉnh cược & thuật toán. 3. Bấm "Bắt đầu Auto" để AI tự phân tích và đặt cược.
              </p>
            </div>
            <div className="flex-1 bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
              <p className="text-[11px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1 mb-2">
                <ShieldCheck className="w-4 h-4" /> Quy định
              </p>
              <p className="text-[12px] text-zinc-700 leading-relaxed font-medium">
                Tool chỉ hỗ trợ phân tích, không cam kết thắng 100%. Vui lòng quản lý vốn và chịu trách nhiệm với tài khoản.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={toggleMusic}
              className={cn(
                "p-3 rounded-2xl transition-all active:scale-90 border",
                isPlaying ? "bg-rose-50 border-rose-100 text-rose-500" : "bg-zinc-50 border-zinc-100 text-zinc-400"
              )}
            >
              {isPlaying ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <button onClick={handleLogout} className="p-3 bg-zinc-50 border border-zinc-100 hover:bg-rose-50 hover:border-rose-100 rounded-2xl text-zinc-400 hover:text-rose-500 transition-all active:scale-90">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Strategy Configuration - Moved to Top */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 md:p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)] hover:shadow-[0_20px_60px_rgba(0,0,0,0.12)] transition-shadow duration-500">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[13px] font-black uppercase tracking-widest flex items-center gap-2 text-zinc-500">
              <Settings className="w-5 h-5 text-zinc-400" /> Cấu hình chiến thuật
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-[12px] font-bold text-zinc-500 uppercase">Thuật toán:</span>
              <select 
                className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-[12px] font-bold outline-none text-black shadow-sm"
                value={algo}
                onChange={(e) => setAlgo(e.target.value as SelectionMode)}
              >
                <option value="VIP50">1. AI GEMINI</option>
                <option value="VIP100">2. AI GPT-4</option>
                <option value="VIP500">3. AI CLAUDE</option>
                <option value="VIP1000">4. AI LLAMA</option>
                <option value="VIP5000">5. AI DEEPSEEK</option>
                <option value="VIP10000">6. AI MISTRAL</option>
                <option value="VIP_ADAPTIVE">7. AI VTH ADAPTIVE</option>
              </select>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <InputGroup label="Cược cơ bản" value={baseBet} onChange={(v) => { setBaseBet(v); setCurrentBet(v); }} type="number" />
            <InputGroup label="Hệ số nhân" value={multiplier} onChange={setMultiplier} type="number" />
          </div>

          <div className="mt-6 flex gap-3">
            <button 
              onClick={handleToggleAuto}
              disabled={isConnecting}
              className={cn(
                "flex-1 py-3 rounded-2xl font-black text-xs tracking-[0.2em] transition-all active:scale-95 shadow-lg",
                isRunning 
                  ? "bg-rose-500 text-white shadow-rose-500/20" 
                  : "bg-zinc-900 text-white shadow-zinc-900/20"
              )}
            >
              {isConnecting ? "ĐANG KẾT NỐI..." : isRunning ? "DỪNG AUTO" : "BẮT ĐẦU AUTO"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Analysis & Rooms */}
          <div className="lg:col-span-7 space-y-4">
            {/* Analysis Section */}
            <div className="bg-white border border-zinc-200 rounded-3xl p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)] hover:shadow-[0_20px_60px_rgba(0,0,0,0.12)] transition-shadow duration-500 text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-zinc-100">
                <motion.div 
                  className="h-full bg-black"
                  animate={{ width: isRunning ? "100%" : "0%" }}
                  transition={{ duration: countdown || 0, ease: "linear" }}
                />
              </div>
              
              <div className="space-y-6">
                <div className="flex items-center justify-center gap-2">
                  <BarChart3 className="w-5 h-5 text-zinc-400" />
                  <p className="text-[13px] font-black tracking-[0.2em] text-zinc-500 uppercase">
                    {uiState === "ANALYZING" ? "ĐANG QUÉT DỮ LIỆU" : 
                     uiState === "PREDICTED" ? "ĐÃ XÁC ĐỊNH PHÒNG" : 
                     uiState === "RESULT" ? "KẾT QUẢ PHIÊN" : "ĐANG CHỜ PHIÊN"}
                  </p>
                </div>

                <div className="flex items-center justify-center gap-8">
                  <div className="text-center">
                    <p className="text-[11px] font-bold text-zinc-400 uppercase">Phiên</p>
                    <p className="text-2xl font-black text-black">{issueId || "---"}</p>
                  </div>
                  <div className="w-px h-12 bg-zinc-100" />
                  <div className="text-center">
                    <p className="text-[11px] font-bold text-zinc-400 uppercase">Đếm ngược</p>
                    <p className="text-4xl font-black text-black">{countdown || 0}s</p>
                  </div>
                </div>

                {predictedRoom && (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-zinc-50 border border-zinc-100 rounded-2xl p-4 inline-flex items-center gap-4"
                  >
                    <div className="p-3 bg-black rounded-xl text-white">
                      <Target className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="text-[11px] font-bold text-zinc-500 uppercase">Phòng dự đoán</p>
                      <p className="text-lg font-black text-black">{ROOM_NAMES[predictedRoom]}</p>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            {/* Rooms Table */}
            <div className="bg-white border border-zinc-200 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] hover:shadow-[0_20px_60px_rgba(0,0,0,0.12)] transition-shadow duration-500 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
                <h3 className="text-[12px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                  <Warehouse className="w-4 h-4" /> Trạng thái phòng
                </h3>
                <div className="flex gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    <span className="text-[11px] font-bold text-zinc-500">An toàn</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                    <span className="text-[11px] font-bold text-zinc-500">Sát thủ</span>
                  </div>
                </div>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {ROOM_ORDER.map(rid => (
                    <motion.div
                      key={rid}
                      whileHover={{ scale: 1.02 }}
                      className={cn(
                        "relative p-3 rounded-2xl border transition-all duration-300 flex flex-col items-center justify-center text-center gap-1",
                        predictedRoom === rid 
                          ? "bg-emerald-50 border-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.1)]" 
                          : killedRoom === rid 
                            ? "bg-rose-50 border-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.1)]"
                            : "bg-white border-zinc-100 shadow-sm"
                      )}
                    >
                      {/* Status Badge */}
                      <div className="absolute top-1.5 right-1.5">
                        {predictedRoom === rid && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                        {killedRoom === rid && <AlertTriangle className="w-4 h-4 text-rose-500" />}
                      </div>

                      <div className={cn(
                        "p-2 rounded-xl",
                        predictedRoom === rid ? "bg-emerald-100 text-emerald-600" : 
                        killedRoom === rid ? "bg-rose-100 text-rose-600" : "bg-zinc-50 text-zinc-400"
                      )}>
                        {getRoomIcon(rid)}
                      </div>

                      <div className="w-full">
                        <p className={cn(
                          "text-[10px] font-black uppercase tracking-tighter truncate px-1",
                          predictedRoom === rid ? "text-emerald-700" : "text-zinc-500"
                        )}>
                          {ROOM_NAMES[rid].replace(/[^a-zA-Z0-9\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, '').trim()}
                        </p>
                        <div className="mt-1 flex justify-between items-center px-1">
                          <div className="flex flex-col items-start">
                            <span className="text-[8px] text-zinc-400 font-bold uppercase leading-none">P</span>
                            <span className="text-[11px] font-black text-zinc-900">{roomState[rid]?.players || 0}</span>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-[8px] text-zinc-400 font-bold uppercase leading-none">Bet</span>
                            <span className="text-[10px] font-black text-rose-500">{roomState[rid]?.bet > 1000 ? (roomState[rid].bet / 1000).toFixed(1) + 'k' : (roomState[rid]?.bet || 0)}</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: History */}
          <div className="lg:col-span-5 space-y-4">
            {/* History Table */}
            <div className="bg-white border border-zinc-200 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] hover:shadow-[0_20px_60px_rgba(0,0,0,0.12)] transition-shadow duration-500 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
                <h3 className="text-[12px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                  <History className="w-4 h-4" /> Lịch sử cược
                </h3>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-white border-b border-zinc-50 text-zinc-400">
                    <tr>
                      <th className="px-6 py-3">Phiên</th>
                      <th className="px-6 py-3">Phòng</th>
                      <th className="px-6 py-3">Sát thủ</th>
                      <th className="px-6 py-3 text-center">Tiền</th>
                      <th className="px-6 py-3 text-right">KQ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {betHistory.slice(-15).reverse().map((bet, i) => (
                      <tr key={i} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-6 py-3 text-zinc-400 font-bold">{bet.issue}</td>
                        <td className="px-6 py-3 font-bold text-black">{ROOM_NAMES[bet.room]}</td>
                        <td className="px-6 py-3 font-bold text-rose-500">{bet.killedRoom ? ROOM_NAMES[bet.killedRoom] : "---"}</td>
                        <td className="px-6 py-3 text-center font-bold text-zinc-700">{bet.amount.toLocaleString()}</td>
                        <td className="px-6 py-3 text-right">
                          <span className={cn(
                            "px-3 py-1 rounded-lg text-[10px] font-black uppercase",
                            bet.result === "Thắng" ? "bg-emerald-100 text-emerald-600" : 
                            bet.result === "Thua" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
                          )}>
                            {bet.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {betHistory.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-zinc-300 italic text-[11px] uppercase tracking-widest">Chưa có dữ liệu cược</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </motion.div>
    </div>
  );
}

function CherryBlossoms() {
  const petals = Array.from({ length: 60 });
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-gradient-to-b from-white to-rose-50/30">
      {petals.map((_, i) => (
        <motion.div
          key={i}
          initial={{ 
            top: -100, 
            left: `${Math.random() * 100}%`, 
            rotate: Math.random() * 360,
            opacity: 0,
            scale: Math.random() * 0.4 + 0.3
          }}
          animate={{ 
            top: "110%", 
            left: `${(Math.random() - 0.5) * 60 + 50}%`,
            rotate: 1440,
            opacity: [0, 0.8, 0.8, 0],
            x: [0, 30, -30, 0]
          }}
          transition={{ 
            duration: Math.random() * 12 + 10, 
            repeat: Infinity, 
            ease: "easeInOut",
            delay: Math.random() * 20
          }}
          className="absolute"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#ffb7c5] drop-shadow-[0_0_6px_rgba(255,183,197,0.6)]">
            <path d="M12 2C14.5 6 19 10 19 15C19 18.866 15.866 22 12 22C8.13401 22 5 18.866 5 15C5 10 9.5 6 12 2Z" fill="currentColor" opacity="0.8"/>
          </svg>
        </motion.div>
      ))}
    </div>
  );
}

function getRoomIcon(rid: number) {
  const icons: Record<number, React.ReactNode> = {
    1: <Warehouse className="w-4 h-4" />,
    2: <Users className="w-4 h-4" />,
    3: <UserCog className="w-4 h-4" />,
    4: <MessageSquare className="w-4 h-4" />,
    5: <Eye className="w-4 h-4" />,
    6: <Briefcase className="w-4 h-4" />,
    7: <DollarSign className="w-4 h-4" />,
    8: <UserPlus className="w-4 h-4" />,
  };
  return icons[rid] || null;
}

function InputGroup({ label, value, onChange, type }: { label: string, value: number, onChange: (v: number) => void, type: "number" | "text" }) {
  const [inputValue, setInputValue] = useState(value.toString());
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(value.toString());
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed)) {
      onChange(parsed);
      setInputValue(parsed.toString());
    } else {
      setInputValue(value.toString());
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-[11px] font-black text-zinc-500 uppercase tracking-widest ml-1">{label}</label>
      <input 
        type={type}
        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-3.5 text-[13px] outline-none focus:border-black focus:shadow-[0_0_20px_rgba(0,0,0,0.05)] transition-all text-black font-bold"
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
