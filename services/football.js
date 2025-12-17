const axios = require("axios");
const config = require("../config");

const api = axios.create({
  baseURL: "https://v3.football.api-sports.io",
  headers: {
    "x-apisports-key": config.apiKey
  }
});

async function getNextGame() {
  const res = await api.get("/fixtures", {
    params: {
      team: config.santosTeamId,
      next: 1,
      timezone: config.timezone
    }
  });
  return res.data.response[0];
}

async function getLineup(fixtureId) {
  const res = await api.get("/fixtures/lineups", {
    params: { fixture: fixtureId }
  });
  return res.data.response;
}

async function getEvents(fixtureId) {
  const res = await api.get("/fixtures/events", {
    params: { fixture: fixtureId }
  });
  return res.data.response;
}

async function getStatistics(fixtureId) {
  const res = await api.get("/fixtures/statistics", {
    params: { fixture: fixtureId }
  });
  return res.data.response;
}

async function getSeasonFixtures(season, leagueId) {
  const res = await api.get("/fixtures", {
    params: {
      team: config.santosTeamId,
      season: season, 
      league: leagueId, 
      timezone: config.timezone
    }
  });
  return res.data.response;
}


module.exports = {
  getNextGame,
  getLineup,
  getEvents,
  getStatistics,
  getSeasonFixtures
};
