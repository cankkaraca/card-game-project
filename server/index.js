const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
// cards.js dosyasının server klasöründe olduğundan emin ol
const { blackCards, whiteCards } = require('./cards');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { 
      origin: "*", 
      methods: ["GET", "POST"] 
  }
});

// VARSAYILAN AYARLAR
const DEFAULT_SETTINGS = {
    maxScore: 10,
    roundDuration: 60000 // 60 saniye
};

let rooms = {};

// KART KARIŞTIRMA
function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

io.on('connection', (socket) => {
  console.log(`🟢 Bağlandı: ${socket.id}`);

  socket.on("join_room", ({ username, room, avatar, password }) => {
    socket.join(room);

    // ODA KURULUMU
    if (!rooms[room]) {
        rooms[room] = {
            players: [],
            gameState: 'LOBBY',
            currentRound: 1,
            blackCard: { text: "Oyun Başlıyor...", pick: 1 },
            tableCards: [], // Masadaki kartlar
            admin: socket.id,
            whiteDeck: shuffle([...whiteCards]),
            blackDeck: shuffle([...blackCards]),
            timerEnd: null,
            timeoutId: null,
            currentCzarIndex: 0, 
            currentCzarId: null,
            settings: { ...DEFAULT_SETTINGS },
            password: password
        };
        console.log(`🏠 Oda kuruldu: ${room} | Admin: ${username}`);
    }
    
    const game = rooms[room];
    const existingPlayerIndex = game.players.findIndex(p => p.username === username);
    let player;

    // OYUNCU YÖNETİMİ
    if (existingPlayerIndex !== -1) {
        player = game.players[existingPlayerIndex];
        player.id = socket.id; 
        player.isOnline = true;
        
        // Admin yetkisini geri ver
        if (game.admin === player.id || !game.players.find(p => p.id === game.admin && p.isOnline)) {
            game.admin = socket.id;
        }

        if (!player.isBot) io.to(socket.id).emit("your_hand", player.hand);
    } else {
        player = { 
            id: socket.id, 
            username, 
            avatar: avatar || "🦁",
            score: 0,
            hand: [],
            drawRights: 3, 
            hasPlayed: false,
            playedCardsTemp: [],
            isCzar: false,
            isOnline: true,
            isAdmin: false,
            isBot: false
        };
        game.players.push(player);
    }

    // Admin kontrolü
    if (!game.players.find(p => p.id === game.admin && p.isOnline)) {
        game.admin = socket.id;
    }

    io.to(room).emit("user_list", game.players.map(p => ({ ...p, isAdmin: p.id === game.admin })));
    io.to(room).emit("game_info", { state: game.gameState, round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: game.timerEnd, czarId: game.currentCzarId });
    
    // Oyun ortasında girdiyse verileri yolla
    if (game.gameState !== 'LOBBY' && !player.isBot) {
        io.to(socket.id).emit("your_hand", player.hand);
        io.to(socket.id).emit("new_black_card", game.blackCard);
        // Gizli kartları gizli olarak yolla
        io.to(socket.id).emit("table_update", game.tableCards.map(c => ({ 
            cards: c.revealed ? c.cards : Array(c.cards.length).fill("GİZLİ"), 
            revealed: c.revealed, 
            ownerId: c.ownerId 
        })));
    }
  });

  // --- OYUN AKIŞI ---

  // Lobiye Dön
  socket.on("return_to_lobby", (room) => {
      const game = rooms[room];
      if (!game || game.admin !== socket.id) return;

      game.gameState = 'LOBBY';
      game.currentRound = 1;
      game.tableCards = [];
      game.timerEnd = null;
      if (game.timeoutId) clearTimeout(game.timeoutId);
      
      game.players.forEach(p => {
          p.score = 0;
          p.hand = [];
          p.drawRights = 3;
          p.hasPlayed = false;
          p.playedCardsTemp = [];
          p.isCzar = false;
      });
      
      game.whiteDeck = shuffle([...whiteCards]);
      game.blackDeck = shuffle([...blackCards]);

      io.to(room).emit("game_info", { state: 'LOBBY', round: 1, maxScore: game.settings.maxScore, timerEnd: null, czarId: null });
      io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin})));
      io.to(room).emit("table_update", []);
  });

  // Bot Ekle
  socket.on("add_bot", (room) => {
      const game = rooms[room];
      if (!game || game.admin !== socket.id) return;

      const botCount = game.players.filter(p => p.isBot).length;
      const botName = `Bot ${botCount + 1} 🤖`;
      
      const botPlayer = {
          id: `bot-${Date.now()}-${Math.random()}`,
          username: botName,
          avatar: "🤖",
          score: 0,
          hand: [],
          drawRights: 3, 
          hasPlayed: false,
          playedCardsTemp: [],
          isCzar: false,
          isOnline: true,
          isAdmin: false,
          isBot: true 
      };

      while(botPlayer.hand.length < 10) {
           if (game.whiteDeck.length === 0) game.whiteDeck = shuffle([...whiteCards]);
           botPlayer.hand.push(game.whiteDeck.pop());
      }

      game.players.push(botPlayer);
      io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin})));
  });

  // --- YARDIMCI FONKSİYONLAR ---
  
  const checkAllPlayed = (game, room) => {
      const activePlayers = game.players.filter(p => p.isOnline && !p.isCzar);
      if (game.tableCards.length >= activePlayers.length && activePlayers.length > 0) {
          clearGameTimer(game);
          startJudgingPhase(room);
      }
  };

  const clearGameTimer = (game) => {
      if (game.timeoutId) { clearTimeout(game.timeoutId); game.timeoutId = null; game.timerEnd = null; }
  };

  const drawBlackCard = (room) => {
      const game = rooms[room];
      if (game.blackDeck.length === 0) game.blackDeck = shuffle([...blackCards]);
      return game.blackDeck.pop();
  };

  function rotateCzar(game) {
      let attempts = 0;
      do {
          game.currentCzarIndex = (game.currentCzarIndex + 1) % game.players.length;
          attempts++;
      } while (!game.players[game.currentCzarIndex].isOnline && attempts < game.players.length);
      game.currentCzarId = game.players[game.currentCzarIndex].id;
  }

  // YARGILAMA FAZI (KARTLAR BURADA GİZLENİR)
  function startJudgingPhase(room) {
      const game = rooms[room];
      game.gameState = 'JUDGING';
      // Kartları karıştır (Anonimlik)
      game.tableCards = game.tableCards.sort(() => Math.random() - 0.5);
      clearGameTimer(game);
      
      io.to(room).emit("game_info", { state: 'JUDGING', round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: null, czarId: game.currentCzarId });
      
      // ÖNEMLİ: Kartları gizli ("GİZLİ") olarak gönderiyoruz ama sayısını doğru veriyoruz
      // Böylece masada kapalı kartlar görünüyor.
      io.to(room).emit("table_update", game.tableCards.map(c => ({ 
          cards: Array(c.cards.length).fill("GİZLİ"), 
          revealed: false, 
          ownerId: c.ownerId 
      })));
      
      triggerBotJudge(game, room);
  }

  function startNewRound(room) {
      const game = rooms[room];
      clearGameTimer(game);
      game.gameState = 'PLAYING';
      game.tableCards = [];
      
      if (game.players.length > 0) {
          const currentCzar = game.players.find(p => p.id === game.currentCzarId);
          if (!currentCzar || !currentCzar.isOnline) rotateCzar(game);
          
          game.players.forEach(p => { 
              p.isCzar = (p.id === game.currentCzarId); 
              p.hasPlayed = false; 
              p.playedCardsTemp = []; 
              p.drawRights = 3; 
          });
      }
      
      game.blackCard = drawBlackCard(room);
      io.to(room).emit("new_black_card", game.blackCard);
      
      game.players.forEach(p => {
          if (!p.isOnline) return;
          while (p.hand.length < 10) {
              if (game.whiteDeck.length === 0) game.whiteDeck = shuffle([...whiteCards]);
              p.hand.push(game.whiteDeck.pop());
          }
          if(!p.isBot) io.to(p.id).emit("your_hand", p.hand);
      });

      game.timerEnd = Date.now() + game.settings.roundDuration;
      io.to(room).emit("table_update", []);
      io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin})));
      io.to(room).emit("game_info", { state: 'PLAYING', round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: game.timerEnd, czarId: game.currentCzarId });
      
      triggerBotPlays(game, room);

      game.timeoutId = setTimeout(() => {
          startJudgingPhase(room);
      }, game.settings.roundDuration);
  }

  // --- BOT ZEKASI ---
  const triggerBotPlays = (game, room) => {
      game.players.forEach(player => {
          if (player.isBot && !player.isCzar && !player.hasPlayed) {
              const delay = Math.random() * 15000 + 5000; 
              setTimeout(() => {
                  if (game.gameState !== 'PLAYING') return;
                  const requiredPick = game.blackCard.pick || 1;
                  player.playedCardsTemp = [];
                  for (let i = 0; i < requiredPick; i++) {
                      if (player.hand.length > 0) {
                          const randIdx = Math.floor(Math.random() * player.hand.length);
                          player.playedCardsTemp.push(player.hand[randIdx]);
                          player.hand.splice(randIdx, 1);
                      }
                  }
                  player.hasPlayed = true;
                  game.tableCards.push({ cards: player.playedCardsTemp, ownerId: player.id, revealed: false });
                  player.playedCardsTemp = [];
                  
                  // Bot oynayınca masayı güncelle (Kapalı olarak)
                  io.to(room).emit("table_update", game.tableCards.map(c => ({ revealed: false, ownerId: c.ownerId })));
                  io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin})));
                  checkAllPlayed(game, room);
              }, delay);
          }
      });
  };

  const triggerBotJudge = (game, room) => {
      const currentCzar = game.players.find(p => p.id === game.currentCzarId);
      if (currentCzar && currentCzar.isBot) {
          setTimeout(() => {
              if (game.gameState !== 'JUDGING') return;
              
              // Önce kartları aç
              game.tableCards.forEach(c => c.revealed = true);
              io.to(room).emit("table_update", game.tableCards.map(c => ({ cards: c.cards, revealed: true, ownerId: c.ownerId })));
              
              // Sonra seç
              setTimeout(() => {
                  if (game.tableCards.length > 0) {
                      const winnerIdx = Math.floor(Math.random() * game.tableCards.length);
                      handlePickWinner(game, room, winnerIdx);
                  }
              }, 4000);
          }, 3000);
      }
  };

  const handlePickWinner = (game, room, cardIndex) => {
      const winningGroup = game.tableCards[cardIndex];
      if (!winningGroup) return;
      
      const winner = game.players.find(p => p.id === winningGroup.ownerId);
      let gameEnded = false;
      
      if (winner) {
          winner.score += 1;
          if (winner.score >= game.settings.maxScore) gameEnded = true;
      }

      game.gameState = 'RESULT';
      clearGameTimer(game);
      
      // Sonucu göster
      io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin})));
      io.to(room).emit("game_info", { state: 'RESULT', round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: null, winnerId: winner?.id });
      // Tüm kartları açık şekilde göster
      io.to(room).emit("table_update", game.tableCards.map(c => ({ cards: c.cards, revealed: true, ownerId: c.ownerId })));
      
      setTimeout(() => {
           if (gameEnded) {
               game.gameState = 'GAME_OVER';
               io.to(room).emit("game_info", { state: 'GAME_OVER', round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: null });
           } else {
               game.currentRound++;
               rotateCzar(game);
               startNewRound(room);
           }
      }, 5000);
  };
  
  // --- SOCKET EVENTLERİ ---
  socket.on("start_game", (room) => { 
      const game = rooms[room]; 
      if(game && game.admin === socket.id) { 
          game.currentRound = 1; 
          game.players.forEach(p=>{
              p.score=0;
              p.hand=[];
              p.drawRights=3; 
              p.hasPlayed=false;
              p.playedCardsTemp=[]
          }); 
          game.currentCzarIndex = Math.floor(Math.random()*game.players.length); 
          startNewRound(room); 
      }
  });

  socket.on("play_card", ({ room, cardText }) => { 
      const game = rooms[room]; 
      if (!game || game.gameState !== 'PLAYING') return; 
      if (socket.id === game.currentCzarId) return;
      
      const player = game.players.find(p => p.id === socket.id); 
      if (!player || player.hasPlayed) return; 
      
      const requiredPick = game.blackCard.pick || 1; 
      
      player.hand = player.hand.filter(c => c !== cardText); 
      player.playedCardsTemp.push(cardText); 
      
      io.to(socket.id).emit("your_hand", player.hand); 
      
      if (player.playedCardsTemp.length === requiredPick) { 
          player.hasPlayed = true; 
          game.tableCards.push({ cards: player.playedCardsTemp, ownerId: socket.id, revealed: false }); 
          player.playedCardsTemp = []; 
      } 
      
      // Diğerlerine sadece "biri oynadı" bilgisini ver (içerik yok)
      io.to(room).emit("table_update", game.tableCards.map(c => ({ revealed: false, ownerId: c.ownerId }))); 
      io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin}))); 
      checkAllPlayed(game, room); 
  });

  socket.on("draw_card", (room) => { 
      const game = rooms[room]; 
      if (!game || game.gameState !== 'PLAYING') return; 
      
      const player = game.players.find(p => p.id === socket.id); 
      if (player && player.drawRights > 0 && !player.hasPlayed && !player.isBot) { 
          player.drawRights--; 
          if(game.whiteDeck.length>0) { 
              player.hand.push(game.whiteDeck.pop()); 
              io.to(player.id).emit("your_hand", player.hand); 
          } 
          io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin}))); 
      }
  });

  // KART AÇMA (Hakem tıklayınca)
  socket.on("reveal_card", ({ room, cardIndex }) => { 
      const game = rooms[room]; 
      if (!game || game.gameState !== 'JUDGING') return; 
      if (socket.id !== game.currentCzarId) return; 
      
      if (game.tableCards[cardIndex]) { 
          game.tableCards[cardIndex].revealed = true; 
          // Sadece bu kartın gerçek içeriğini herkese gönder
          io.to(room).emit("table_update", game.tableCards.map(c => ({ 
              cards: c.revealed ? c.cards : Array(c.cards.length).fill("GİZLİ"), 
              revealed: c.revealed, 
              ownerId: c.ownerId 
          }))); 
      }
  });

  socket.on("pick_winner", ({ room, cardIndex }) => { 
      const game = rooms[room]; 
      if (!game || game.gameState !== 'JUDGING') return; 
      if (socket.id !== game.currentCzarId) return; 
      handlePickWinner(game, room, cardIndex); 
  });

  socket.on("force_finish_voting", (room) => { 
      const game = rooms[room]; 
      if(game && game.admin === socket.id) { 
          clearGameTimer(game); 
          startJudgingPhase(room); 
      }
  });

  socket.on("update_settings", ({ room, settings }) => { 
      const game = rooms[room]; 
      if (!game || game.admin !== socket.id) return; 
      game.settings = { ...game.settings, ...settings }; 
      io.to(room).emit("game_info", { state: game.gameState, round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: game.timerEnd, czarId: game.currentCzarId }); 
  });

  socket.on("kick_player", ({ room, targetUsername }) => { 
      const game = rooms[room]; 
      if (!game || game.admin !== socket.id) return; 
      
      const targetIndex = game.players.findIndex(p => p.username === targetUsername); 
      if (targetIndex !== -1) { 
          const targetPlayer = game.players[targetIndex]; 
          if(!targetPlayer.isBot) io.to(targetPlayer.id).emit("kicked"); 
          game.players.splice(targetIndex, 1); 
          io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin}))); 
      }
  });
  // --- ODAYI TAMAMEN SİLME (Admin Çıkınca) ---
  socket.on("destroy_room", (room) => {
    const game = rooms[room];
    // Güvenlik: Sadece admin silebilir
    if (game && game.admin === socket.id) {
        console.log(`🧨 ODA İMHA EDİLDİ: ${room}`);
        
        // Odadaki diğer herkese "Oda kapandı" mesajı yolla ki onlar da menüye dönsün
        io.to(room).emit("kicked"); 
        
        // Odayı hafızadan sil
        delete rooms[room];
    }
});

  socket.on("disconnect", () => { 
      const player = Object.values(rooms).flatMap(r => r.players).find(p => p.id === socket.id); 
      if (player) player.isOnline = false; 
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ OYUN MOTORU HAZIR: Port ${PORT}`);
});