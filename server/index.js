const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { blackCards, whiteCards } = require('./cards');

const app = express();

// DÜZELTME 1: CORS'u "*" yaptık ki her yerden (Vercel'den) bağlanılabilsin.
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { 
      origin: "*", // ÖNEMLİ: Güvenlik kilidini açtık
      methods: ["GET", "POST"] 
  }
});

// ... (Buradaki 'let rooms = {}' ve diğer oyun kodları AYNEN KALSIN) ...

// EN ALTTA: Port Ayarı

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

    if (!rooms[room]) {
        rooms[room] = {
            players: [],
            gameState: 'LOBBY',
            currentRound: 1,
            blackCard: { text: "Oyun Başlıyor...", pick: 1 },
            tableCards: [],
            admin: socket.id,
            whiteDeck: shuffle([...whiteCards]),
            blackDeck: shuffle([...blackCards]),
            timerEnd: null,
            timeoutId: null,
            currentCzarIndex: 0, 
            currentCzarId: null,
            settings: { ...DEFAULT_SETTINGS }
        };
    }
    
    const game = rooms[room];
    const existingPlayerIndex = game.players.findIndex(p => p.username === username);
    let player;

    if (existingPlayerIndex !== -1) {
        player = game.players[existingPlayerIndex];
        player.id = socket.id; 
        player.isOnline = true;
        if (!player.isBot) io.to(socket.id).emit("your_hand", player.hand);
    } else {
        player = { 
            id: socket.id, 
            username, 
            avatar: avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=Guest",
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

    if (game.admin === socket.id || !game.players.find(p => p.id === game.admin)) {
        game.admin = socket.id;
    }

    io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin})));
    io.to(room).emit("game_info", { state: game.gameState, round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: game.timerEnd, czarId: game.currentCzarId });
    
    if (game.gameState !== 'LOBBY' && !player.isBot) {
        io.to(socket.id).emit("your_hand", player.hand);
        io.to(socket.id).emit("new_black_card", game.blackCard);
        io.to(socket.id).emit("table_update", game.tableCards.map(c => ({ cards: c.revealed ? c.cards : [], revealed: c.revealed, ownerId: c.ownerId })));
    }
  });

  // --- YENİ EKLENEN: LOBİYE DÖN (RESET) ---
  socket.on("return_to_lobby", (room) => {
      const game = rooms[room];
      if (!game || game.admin !== socket.id) return; // Sadece admin yapabilir

      // Odayı sıfırla
      game.gameState = 'LOBBY';
      game.currentRound = 1;
      game.tableCards = [];
      game.timerEnd = null;
      if (game.timeoutId) clearTimeout(game.timeoutId);
      
      // Oyuncuları sıfırla
      game.players.forEach(p => {
          p.score = 0;
          p.hand = [];
          p.drawRights = 3;
          p.hasPlayed = false;
          p.playedCardsTemp = [];
          p.isCzar = false;
      });
      
      // Desteleri tazele
      game.whiteDeck = shuffle([...whiteCards]);
      game.blackDeck = shuffle([...blackCards]);

      // Herkese haber ver
      io.to(room).emit("game_info", { 
          state: 'LOBBY', 
          round: 1, 
          maxScore: game.settings.maxScore, 
          timerEnd: null, 
          czarId: null 
      });
      io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin})));
      io.to(room).emit("table_update", []);
  });

  socket.on("add_bot", (room) => {
      const game = rooms[room];
      if (!game || game.admin !== socket.id) return;

      const botCount = game.players.filter(p => p.isBot).length;
      const botName = `Bot ${botCount + 1} 🤖`;
      
      const botPlayer = {
          id: `bot-${Date.now()}-${Math.random()}`,
          username: botName,
          avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${botName}`,
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

  const triggerBotPlays = (game, room) => {
      game.players.forEach(player => {
          if (player.isBot && !player.isCzar && !player.hasPlayed) {
              const delay = Math.random() * 5000 + 2000; 
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
              game.tableCards.forEach(c => c.revealed = true);
              io.to(room).emit("table_update", game.tableCards.map(c => ({ cards: c.cards, revealed: true, ownerId: c.ownerId })));
              setTimeout(() => {
                  if (game.tableCards.length > 0) {
                      const winnerIdx = Math.floor(Math.random() * game.tableCards.length);
                      handlePickWinner(game, room, winnerIdx);
                  }
              }, 3000);
          }, 4000);
      }
  };

  const checkAllPlayed = (game, room) => {
      const activePlayers = game.players.filter(p => p.isOnline && !p.isCzar);
      if (game.tableCards.length >= activePlayers.length && activePlayers.length > 0) {
          clearGameTimer(game);
          startJudgingPhase(room);
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
      io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin})));
      io.to(room).emit("game_info", { state: 'RESULT', round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: null, winnerId: winner?.id });
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

  function startJudgingPhase(room) {
      const game = rooms[room];
      game.gameState = 'JUDGING';
      game.tableCards = game.tableCards.sort(() => Math.random() - 0.5);
      clearGameTimer(game);
      io.to(room).emit("game_info", { state: 'JUDGING', round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: null, czarId: game.currentCzarId });
      io.to(room).emit("table_update", game.tableCards.map(c => ({ cards: [], revealed: false, ownerId: c.ownerId })));
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
          game.players.forEach(p => {
              if (!p.isCzar && !p.hasPlayed && p.isOnline) {
                  const required = (game.blackCard.pick || 1) - p.playedCardsTemp.length;
                  for(let i=0; i<required; i++) {
                      if(p.hand.length > 0) {
                          const randIdx = Math.floor(Math.random() * p.hand.length);
                          p.playedCardsTemp.push(p.hand[randomIdx]);
                          p.hand.splice(randIdx, 1);
                      }
                  }
                  p.hasPlayed = true;
                  if(!p.isBot) io.to(p.id).emit("your_hand", p.hand);
                  if(p.playedCardsTemp.length > 0) { game.tableCards.push({ cards: p.playedCardsTemp, ownerId: p.id, revealed: false }); }
                  p.playedCardsTemp = [];
              }
          });
          io.to(room).emit("table_update", game.tableCards.map(c => ({ revealed: false, ownerId: c.ownerId })));
          io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin})));
          startJudgingPhase(room);
      }, game.settings.roundDuration);
  }
  
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

  socket.on("play_card", ({ room, cardText }) => { const game = rooms[room]; if (!game || game.gameState !== 'PLAYING') return; if (socket.id === game.currentCzarId) return; const player = game.players.find(p => p.id === socket.id); if (!player || player.hasPlayed) return; const requiredPick = game.blackCard.pick || 1; player.hand = player.hand.filter(c => c !== cardText); player.playedCardsTemp.push(cardText); io.to(socket.id).emit("your_hand", player.hand); if (player.playedCardsTemp.length === requiredPick) { player.hasPlayed = true; game.tableCards.push({ cards: player.playedCardsTemp, ownerId: socket.id, revealed: false }); player.playedCardsTemp = []; } io.to(room).emit("table_update", game.tableCards.map(c => ({ revealed: false, ownerId: c.ownerId }))); io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin}))); checkAllPlayed(game, room); });
  socket.on("draw_card", (room) => { const game = rooms[room]; if (!game || game.gameState !== 'PLAYING') return; const player = game.players.find(p => p.id === socket.id); if (player && player.drawRights > 0 && !player.hasPlayed && !player.isBot) { player.drawRights--; if(game.whiteDeck.length>0) { player.hand.push(game.whiteDeck.pop()); io.to(player.id).emit("your_hand", player.hand); } io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin}))); }});
  socket.on("reveal_card", ({ room, cardIndex }) => { const game = rooms[room]; if (!game || game.gameState !== 'JUDGING') return; if (socket.id !== game.currentCzarId) return; if (game.tableCards[cardIndex]) { game.tableCards[cardIndex].revealed = true; io.to(room).emit("table_update", game.tableCards.map(c => ({ cards: c.cards, revealed: c.revealed, ownerId: c.ownerId }))); }});
  socket.on("pick_winner", ({ room, cardIndex }) => { const game = rooms[room]; if (!game || game.gameState !== 'JUDGING') return; if (socket.id !== game.currentCzarId) return; handlePickWinner(game, room, cardIndex); });
  socket.on("force_finish_voting", (room) => { const game = rooms[room]; if(game && game.admin === socket.id) { clearGameTimer(game); startJudgingPhase(room); }});
  socket.on("update_settings", ({ room, settings }) => { const game = rooms[room]; if (!game || game.admin !== socket.id) return; game.settings = { ...game.settings, ...settings }; io.to(room).emit("game_info", { state: game.gameState, round: game.currentRound, maxScore: game.settings.maxScore, timerEnd: game.timerEnd, czarId: game.currentCzarId }); });
  socket.on("kick_player", ({ room, targetUsername }) => { const game = rooms[room]; if (!game || game.admin !== socket.id) return; const targetIndex = game.players.findIndex(p => p.username === targetUsername); if (targetIndex !== -1) { const targetPlayer = game.players[targetIndex]; if(!targetPlayer.isBot) io.to(targetPlayer.id).emit("kicked"); game.players.splice(targetIndex, 1); io.to(room).emit("user_list", game.players.map(p => ({...p, isAdmin: p.id === game.admin}))); }});
  socket.on("disconnect", () => { const player = Object.values(rooms).flatMap(r => r.players).find(p => p.id === socket.id); if (player) player.isOnline = false; });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`✅ OYUN MOTORU HAZIR: Port ${PORT}`);
});