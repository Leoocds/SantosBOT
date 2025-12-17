require("dotenv").config();

const http = require("http");

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200);
    res.end("ok");
  } else {
    res.writeHead(200);
    res.end("Santos Bot rodando");
  }
}).listen(PORT, () => {
  console.log(`🌐 Health server listening on ${PORT}`);
});

const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");

const {
  getNextGame,
  getLineup,
  getEvents,
  getStatistics,
  getSeasonFixtures,
} = require("./services/football");

const config = require("./config.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
});

// BANCO SIMPLES (JSON)
let db = {};
try {
  db = JSON.parse(fs.readFileSync("./db.json"));
} catch {
  db = {};
}

function saveDB() {
  fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
}

// ROLE SANTISTA
async function getSantistasRole(guild) {
  return guild.roles.cache.find((r) => r.name.toLowerCase() === "santista");
}

// FUNÇÃO CALENDÁRIO
async function updateCalendar() {
  if (!db.calendarChannelId) return;

  const guild = client.guilds.cache.first();
  const role = await getSantistasRole(guild);
  const mention = role ? `<@&${role.id}>` : "";

  const channel = await client.channels.fetch(db.calendarChannelId);
  if (!channel) return;

  const fixtures = await getSeasonFixtures(config.santosTeamId);
  if (!fixtures || fixtures.length === 0) return;

  let description = "";
  fixtures.forEach((game) => {
    description += `🆚 **${game.teams.home.name} x ${game.teams.away.name}**\n`;
    description += `🏆 ${game.league.name}\n`;
    description += `📅 ${new Date(game.fixture.date).toLocaleString(
      "pt-BR"
    )}\n`;
    description += `📍 ${game.fixture.venue?.name || "Não informado"}\n\n`;
  });

  const embed = new EmbedBuilder()
    .setTitle("📅 Calendário do Santos — Temporada")
    .setDescription(description)
    .setColor("#0000FF");

  if (db.calendarMessageId) {
    try {
      const msg = await channel.messages.fetch(db.calendarMessageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch (err) {
      console.log("Mensagem de calendário não encontrada, criando nova...");
    }
  }

  const message = await channel.send({
    content: mention,
    allowedMentions: { roles: role ? [role.id] : [] },
    embeds: [embed],
  });
  db.calendarMessageId = message.id;
  saveDB();
}

// BOT ONLINE
client.once(Events.ClientReady, async () => {
  console.log("🐳 Santos Bot online!");

  const commandData = new SlashCommandBuilder()
    .setName("set-canal")
    .setDescription("Define canais do Santos Bot")
    .addStringOption((opt) =>
      opt
        .setName("tipo")
        .setDescription("Tipo de canal")
        .setRequired(true)
        .addChoices(
          { name: "Informações do Jogo", value: "info" },
          { name: "Escalação", value: "lineup" },
          { name: "Tempo Real", value: "live" },
          { name: "Craque do Jogo", value: "mvp" },
          { name: "Calendário", value: "calendar" }
        )
    );

  const guild = client.guilds.cache.first();
  if (guild) {
    await guild.commands.set([commandData]);
    console.log("✅ Comando /set-canal atualizado no servidor.");
  }

  // CRON (1 MIN)
  cron.schedule("*/1 * * * *", async () => {
    console.log("⏱️ Cron executando...");
    try {
      const game = await getNextGame();
      if (!game) return;
      if (db.fixtureId !== game.fixture.id) {
        db.fixtureId = game.fixture.id;
        db.infoSent = false;
        db.lineupSent = false;
        db.gameStarted = false;
        db.gameFinished = false;
        db.eventsSent = [];
        saveDB();
      }
      const guild = client.guilds.cache.first();
      const role = await getSantistasRole(guild);
      const mention = role ? `<@&${role.id}>` : "";

      // 📺 INFO DO JOGO
      if (
        db.infoChannelId &&
        game.fixture.status.short === "NS" &&
        !db.infoSent
      ) {
        const channel = await client.channels.fetch(db.infoChannelId);

        const embed = new EmbedBuilder()
          .setTitle("ℹ️ INFORMAÇÕES DO JOGO")
          .addFields(
            {
              name: "🆚 Confronto",
              value: `${game.teams.home.name} x ${game.teams.away.name}`,
            },
            {
              name: "📅 Data e Hora",
              value: new Date(game.fixture.date).toLocaleString("pt-BR"),
            },
            {
              name: "📍 Estádio",
              value: game.fixture.venue?.name || "Não informado",
            },
            {
              name: "📺 Transmissão",
              value: "Premiere / SporTV",
            }
          )
          .setColor("#000000");

        await channel.send({
          content: mention,
          allowedMentions: { roles: role ? [role.id] : [] },
          embeds: [embed],
        });

        db.infoSent = true;
        saveDB();
      }

      // 📋 ESCALAÇÃO
      if (!db.lineupSent && db.lineupChannelId) {
        const lineups = await getLineup(game.fixture.id);

        if (lineups.length > 0) {
          const santos = lineups.find((l) => l.team.id === config.santosTeamId);
          if (!santos) return;

          const players = santos.startXI.map((p) => p.player.name).join("\n");

          const embed = new EmbedBuilder()
            .setTitle("📋 ESCALAÇÃO DO SANTOS")
            .setDescription(players)
            .setColor("#FFFFFF");

          const channel = await client.channels.fetch(db.lineupChannelId);

          await channel.send({
            content: mention,
            allowedMentions: { roles: role ? [role.id] : [] },
            embeds: [embed],
          });

          db.lineupSent = true;
          saveDB();
        }
      }

      // ▶️ INÍCIO DO JOGO
      if (
        game.fixture.status.short === "1H" &&
        !db.gameStarted &&
        db.liveChannelId
      ) {
        db.gameStarted = true;
        saveDB();

        const channel = await client.channels.fetch(db.liveChannelId);

        const embed = new EmbedBuilder()
          .setTitle("▶️ BOLA ROLANDO!")
          .setDescription("O Santos já está em campo!")
          .setColor("#00FF00");

        await channel.send({
          content: mention,
          allowedMentions: { roles: role ? [role.id] : [] },
          embeds: [embed],
        });
      }

      // 🔴 TEMPO REAL
      if (
        db.liveChannelId &&
        ["1H", "2H", "ET", "P"].includes(game.fixture.status.short)
      ) {
        const channel = await client.channels.fetch(db.liveChannelId);

        const events = await getEvents(game.fixture.id);
        if (!events || events.length === 0) return;

        for (const event of events) {
          const eventId = `${event.time.elapsed}-${event.type}-${event.player?.name}-${event.team?.id}`;

          if (db.eventsSent.includes(eventId)) continue;

          const isSantos = event.team?.id === config.santosTeamId;
          const teamEmoji = isSantos ? "🤍🖤" : "🔴⚪";
          const teamName = event.team?.name || "Time";

          let text = "";

          switch (event.type) {
            case "Goal":
              text = `⚽ **GOL!** ${teamEmoji}\n${teamName}\n👤 ${event.player.name}\n⏱️ ${event.time.elapsed}'`;
              break;

            case "Card":
              if (event.detail === "Yellow Card") {
                text = `🟨 Cartão amarelo\n${teamEmoji} ${event.player.name}\n⏱️ ${event.time.elapsed}'`;
              }
              if (event.detail === "Red Card") {
                text = `🟥 Cartão vermelho\n${teamEmoji} ${event.player.name}\n⏱️ ${event.time.elapsed}'`;
              }
              break;

            case "Substitution":
              text = `🔁 **Substituição** ${teamEmoji}\nSai ⛔ ${event.assist?.name}\nEntra ✅ ${event.player.name}\n⏱️ ${event.time.elapsed}'`;
              break;
          }

          if (text) {
            await channel.send(text);
            db.eventsSent.push(eventId);
            saveDB();
          }
        }
      }

      // ⏹️ FIM DE JOGO
      if (
        game.fixture.status.short === "FT" &&
        !db.gameFinished &&
        db.liveChannelId
      ) {
        db.gameFinished = true;
        saveDB();

        const channel = await client.channels.fetch(db.liveChannelId);

        const home = game.teams.home;
        const away = game.teams.away;
        const goalsHome = game.goals.home;
        const goalsAway = game.goals.away;

        let resultText = "🤝 **EMPATE!**";

        if (goalsHome > goalsAway) {
          resultText =
            home.id === config.santosTeamId
              ? "🏆 **VITÓRIA DO SANTOS!** 🤍🖤"
              : "❌ **DERROTA DO SANTOS**";
        }

        if (goalsAway > goalsHome) {
          resultText =
            away.id === config.santosTeamId
              ? "🏆 **VITÓRIA DO SANTOS!** 🤍🖤"
              : "❌ **DERROTA DO SANTOS**";
        }

        const embed = new EmbedBuilder()
          .setTitle("⏹️ FIM DE JOGO")
          .setDescription(
            `${resultText}\n\n${home.name} ${goalsHome} x ${goalsAway} ${away.name}`
          )
          .setColor(
            resultText.includes("VITÓRIA")
              ? "#00FF00"
              : resultText.includes("DERROTA")
              ? "#FF0000"
              : "#FFFF00"
          );

        await channel.send({ content: mention, embeds: [embed] });
      }
    } catch (err) {
      console.error("Erro no cron:", err);
    }
  });
});

// SLASH COMMAND
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "set-canal") {
    const tipo = interaction.options.getString("tipo");

    const map = {
      info: "infoChannelId",
      lineup: "lineupChannelId",
      live: "liveChannelId",
      mvp: "mvpChannelId",
      calendar: "calendarChannelId",
    };

    db[map[tipo]] = interaction.channelId;
    saveDB();

    await interaction.reply({
      content: `🐳 Canal de **${tipo}** configurado com sucesso!`,
      flags: 64,
    });
  }
});

client.login(config.discordToken);
