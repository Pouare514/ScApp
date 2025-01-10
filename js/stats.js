import { LeaguepediaAPI } from './leagueStats.js';

const RIOT_API_KEY = 'Mettre la clé API ici';

class RateLimiter {
    constructor(requestsPerSecond, requestsPer2Minutes) {
        this.requestsPerSecond = requestsPerSecond;
        this.requestsPer2Minutes = requestsPer2Minutes;
        this.requests = [];
        this.twoMinRequests = [];
    }

    async waitForSlot() {
        const now = Date.now();
        
        // Nettoyer les anciennes requêtes
        this.requests = this.requests.filter(time => time > now - 1000);
        this.twoMinRequests = this.twoMinRequests.filter(time => time > now - 120000);

        // Vérifier les limites
        while (
            this.requests.length >= this.requestsPerSecond ||
            this.twoMinRequests.length >= this.requestsPer2Minutes
        ) {
            const oldestTime = Math.min(
                this.requests[0] || now,
                this.twoMinRequests[0] || now
            );
            const waitTime = Math.max(
                oldestTime + 1000 - now,
                oldestTime + 120000 - now
            );
            await new Promise(resolve => setTimeout(resolve, waitTime));
            now = Date.now();
            this.requests = this.requests.filter(time => time > now - 1000);
            this.twoMinRequests = this.twoMinRequests.filter(time => time > now - 120000);
        }

        this.requests.push(now);
        this.twoMinRequests.push(now);
    }

    async executeRequest(requestFn) {
        await this.waitForSlot();
        return requestFn();
    }
}


// Classe pour gérer l'analyse des joueurs
class PlayerAnalyzer {
    constructor() {
        this.iconTemplate = document.getElementById('player-icon-template');
        this.statsTemplate = document.getElementById('player-card-template'); // Correction ici
        this.iconsContainer = document.querySelector('.player-icons-circle');
        this.statsContainer = document.getElementById('player-stats');
        this.players = window.PLAYERS || [];
        this.rateLimiter = new RateLimiter(20, 100);
        this.currentPlayer = null;
        this.leaguepediaAPI = new LeaguepediaAPI();
    }

    initialize() {
        // Sélectionner les containers avec la classe spécifique
        const playerContainers = document.querySelectorAll('.player-icon-container');
        
        if (!playerContainers || playerContainers.length === 0) {
            console.warn('No player containers found');
            return;
        }

        playerContainers.forEach(container => {
            container.addEventListener('click', () => {
                const gameName = container.getAttribute('data-game-name');
                const tagLine = container.getAttribute('data-tag-line');
                const role = container.getAttribute('data-role');

                // Retirer la classe active de tous les conteneurs
                playerContainers.forEach(c => c.classList.remove('active'));
                // Ajouter la classe active au conteneur cliqué
                container.classList.add('active');

                this.showPlayerStats(gameName, tagLine, role);
            });
        });
    }

    createPlayerIcon(player, container) {
        const iconContent = this.iconTemplate.content.cloneNode(true);
        const iconContainer = iconContent.querySelector('.player-icon-container');
        const iconBox = iconContent.querySelector('.player-icon-box');
        const img = iconContent.querySelector('img');
        const name = iconContent.querySelector('.player-name');
        const role = iconContent.querySelector('.player-role');

        // Configuration de l'icône
        img.src = '/images/default-icon.png';
        img.alt = `${player.gameName} icon`;
        name.textContent = player.gameName;
        role.textContent = this.getRoleName(player.role);

        // Gestion du clic
        iconBox.addEventListener('click', () => {
            document.querySelectorAll('.player-icon-box').forEach(box => {
                box.classList.remove('active');
            });
            iconBox.classList.add('active');
            this.loadPlayerStats(player);
        });

        container.appendChild(iconContainer);
    }

    getRoleName(role) {
        const roles = {
            'TOP': 'Top Lane',
            'JGL': 'Jungle',
            'MID': 'Mid Lane',
            'ADC': 'Bot Lane',
            'SUP': 'Support'
        };
        return roles[role] || role;
    }

    async loadPlayerStats(player) {
        if (this.currentPlayer === player.gameName) return;
        this.currentPlayer = player.gameName;

        // Afficher un état de chargement
        this.statsContainer.classList.remove('hidden');
        this.statsContainer.innerHTML = `
            <div class="bg-white rounded-xl p-6 shadow-lg">
                <p class="text-gray-600">Chargement des données de ${player.gameName}...</p>
            </div>
        `;

        try {
            const playerData = await this.getPlayerData(player.gameName, player.tagLine);
            const analysis = this.analyzeData(playerData);
            await this.displayPlayerStats(player, playerData, analysis);
        } catch (error) {
            this.displayError(player, error);
        }
    }

    async showPlayerStats(gameName, tagLine, role) {
        // Afficher un état de chargement
        const statsDiv = document.getElementById('player-stats');
        statsDiv.classList.remove('hidden');
        statsDiv.innerHTML = `
            <div class="bg-white rounded-xl p-6 shadow-lg">
                <p class="text-gray-600">Chargement des données de ${gameName}...</p>
            </div>
        `;

        try {
            const playerData = await this.getPlayerData(gameName, tagLine);
            const analysis = this.analyzeData(playerData);
            await this.displayPlayerStats({ gameName, tagLine, role }, playerData, analysis);
        } catch (error) {
            this.displayError({ gameName, tagLine }, error);
        }
    }

    displayError(player, error) {
        this.statsContainer.innerHTML = `
            <div class="bg-white rounded-xl p-6 shadow-lg">
                <div class="flex items-center gap-4">
                    <div class="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
                        <i class="fas fa-exclamation-triangle text-gray-400 text-2xl"></i>
                    </div>
                    <div>
                        <h2 class="text-2xl font-bold">${player.gameName}#${player.tagLine}</h2>
                        <div class="text-red-500">
                            ${error.message === 'Request failed with status code 404' 
                                ? 'Joueur non trouvé' 
                                : 'Erreur lors du chargement des données'}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async getPlayerData(gameName, tagLine) {
        try {
            // Mapper les noms de jeu aux noms Leaguepedia
            const leaguepediaNames = {
                "loyal tea": "Highway",
                "MAT": "MAT",
                "Roshan": "Roshan",
                "Camille fan acc": "Artoria",
                "xicor": "xicor"
            };

            const leaguepediaName = leaguepediaNames[gameName] || gameName;
            
            // Récupérer les données avec le nom correct
            const playerStats = await this.leaguepediaAPI.fetchPlayerStats(leaguepediaName);
            const tournamentResults = await this.leaguepediaAPI.fetchTournamentResults(leaguepediaName);

            // 2. Formater les données
            const stats = {
                totalGames: playerStats.TotalGames || 0,
                wins: playerStats.Wins || 0,
                losses: playerStats.Losses || 0,
                kda: {
                    kills: playerStats.AverageKills || 0,
                    deaths: playerStats.AverageDeaths || 0,
                    assists: playerStats.AverageAssists || 0,
                    ratio: playerStats.KDA || 0
                },
                championStats: this.formatChampionStats(playerStats.ChampionsPlayed),
                winRate: playerStats.WinRate || 0,
                tournamentHistory: tournamentResults.map(t => ({
                    name: t.Tournament,
                    position: t.Position,
                    team: t.Team
                }))
            };

            return {
                accountInfo: {
                    gameName,
                    tagLine,
                    profileIconId: 1
                },
                stats: stats
            };
        } catch (error) {
            console.error('Erreur API Leaguepedia:', error);
            throw error;
        }
    }

    formatChampionStats(championsData) {
        if (!championsData) return {};
        
        return Object.entries(championsData).reduce((acc, [champion, data]) => {
            acc[champion] = {
                games: data.GamesPlayed || 0,
                wins: data.Wins || 0,
                winRate: data.WinRate || 0
            };
            return acc;
        }, {});
    }

    analyzeMatchHistory(matches, puuid) {
        const stats = {
            totalGames: matches.length,
            wins: 0,
            losses: 0,
            kda: { kills: 0, deaths: 0, assists: 0 },
            championStats: {},
            roleStats: {},
            winRate: 0
        };

        matches.forEach(match => {
            const participant = match.info.participants.find(p => p.puuid === puuid);
            if (!participant) return;

            // Statistiques de base
            if (participant.win) {
                stats.wins++;
            } else {
                stats.losses++;
            }

            // KDA
            stats.kda.kills += participant.kills;
            stats.kda.deaths += participant.deaths;
            stats.kda.assists += participant.assists;

            // Champion stats
            const champion = participant.championName;
            if (!stats.championStats[champion]) {
                stats.championStats[champion] = {
                    games: 0,
                    wins: 0,
                    winRate: 0
                };
            }
            stats.championStats[champion].games++;
            if (participant.win) {
                stats.championStats[champion].wins++;
            }
            stats.championStats[champion].winRate = 
                ((stats.championStats[champion].wins / stats.championStats[champion].games) * 100).toFixed(1);

            // Role stats
            const role = participant.teamPosition || 'UNKNOWN';
            if (!stats.roleStats[role]) {
                stats.roleStats[role] = {
                    games: 0,
                    wins: 0,
                    winRate: 0
                };
            }
            stats.roleStats[role].games++;
            if (participant.win) {
                stats.roleStats[role].wins++;
            }
            stats.roleStats[role].winRate = 
                ((stats.roleStats[role].wins / stats.roleStats[role].games) * 100).toFixed(1);
        });

        // Calculs finaux
        stats.winRate = ((stats.wins / stats.totalGames) * 100).toFixed(1);
        stats.kda.ratio = ((stats.kda.kills + stats.kda.assists) / Math.max(1, stats.kda.deaths)).toFixed(2);

        // Trouver le champion le plus joué
        stats.mostPlayedChampion = Object.entries(stats.championStats)
            .sort((a, b) => b[1].games - a[1].games)[0];

        // Trouver le rôle principal
        stats.mainRole = Object.entries(stats.roleStats)
            .sort((a, b) => b[1].games - a[1].games)[0];

        return stats;
    }

    analyzeData(playerData) {
        const stats = playerData.stats;
        return {
            strengths: this.getStrengths(stats),
            weaknesses: this.getWeaknesses(stats),
            tournaments: stats.tournamentHistory
        };
    }

    getStrengths(stats) {
        const strengths = [];
        
        if (parseFloat(stats.winRate) >= 55) {
            strengths.push({
                icon: 'trophy',
                color: 'yellow',
                text: `Win Rate élevé (${stats.winRate}%)`
            });
        }

        if (parseFloat(stats.kda.ratio) >= 3) {
            strengths.push({
                icon: 'star',
                color: 'blue',
                text: `KDA excellent (${stats.kda.ratio})`
            });
        }

        return strengths;
    }

    getWeaknesses(stats) {
        const weaknesses = [];
        
        if (parseFloat(stats.winRate) < 45) {
            weaknesses.push({
                icon: 'chart-line-down',
                color: 'red',
                text: `Win Rate faible (${stats.winRate}%)`
            });
        }

        if (parseFloat(stats.kda.ratio) < 2) {
            weaknesses.push({
                icon: 'skull',
                color: 'red',
                text: `KDA faible (${stats.kda.ratio})`
            });
        }

        return weaknesses;
    }

    async displayPlayerStats(player, playerData, analysis) {
        return new Promise((resolve) => {
            setTimeout(() => {
                if (!this.statsTemplate) {
                    console.error('Template non trouvé : player-card-template');
                    return;
                }

                this.statsContainer.innerHTML = '';
                const statsContent = this.statsTemplate.content.cloneNode(true);
                
                // Infos de base
                statsContent.querySelector('.player-name').textContent = `${player.gameName}#${player.tagLine}`;
                statsContent.querySelector('.player-winrate').textContent = `Win Rate: ${playerData.stats.winRate}%`;
                statsContent.querySelector('.player-wins-losses').textContent = 
                    `${playerData.stats.wins}W ${playerData.stats.losses}L`;

                // KDA et autres stats
                statsContent.querySelector('.player-kda').textContent = playerData.stats.kda.ratio;
                statsContent.querySelector('.player-overall-wr').textContent = `${playerData.stats.winRate}%`;
                statsContent.querySelector('.player-total-games').textContent = playerData.stats.totalGames;
                statsContent.querySelector('.player-main-role').textContent = 
                    playerData.stats.mainRole ? playerData.stats.mainRole[0] : 'N/A';

                // Points forts et faibles
                const strengthsList = statsContent.querySelector('.strengths-list');
                const weaknessesList = statsContent.querySelector('.weaknesses-list');

                analysis.strengths.forEach(strength => {
                    const li = document.createElement('li');
                    li.classList.add('flex', 'items-start');
                    li.innerHTML = `
                        <i class="fas fa-${strength.icon} text-${strength.color}-500 mt-1 mr-2"></i>
                        <span>${strength.text}</span>
                    `;
                    strengthsList.appendChild(li);
                });

                analysis.weaknesses.forEach(weakness => {
                    const li = document.createElement('li');
                    li.classList.add('flex', 'items-start');
                    li.innerHTML = `
                        <i class="fas fa-${weakness.icon} text-${weakness.color}-500 mt-1 mr-2"></i>
                        <span>${weakness.text}</span>
                    `;
                    weaknessesList.appendChild(li);
                });

                // Stats des champions avec KDA
                const championsStatsBody = statsContent.querySelector('.champions-stats-body');
                if (playerData.stats.ChampionsPlayed && typeof playerData.stats.ChampionsPlayed === 'object') {
                    Object.entries(playerData.stats.ChampionsPlayed)
                        .sort((a, b) => b[1].games - a[1].games)
                        .forEach(([champion, stats]) => {
                            const row = document.createElement('tr');
                            row.innerHTML = `
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <div class="font-medium text-gray-900">${champion}</div>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-gray-500">
                                    ${stats.games || 0}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <span class="text-${parseFloat(stats.winRate) >= 55 ? 'green' : parseFloat(stats.winRate) <= 45 ? 'red' : 'gray'}-600">
                                        ${stats.winRate || "0"}%
                                    </span>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-gray-500">
                                    ${stats.kda || '0'}
                                </td>
                            `;
                            championsStatsBody.appendChild(row);
                        });
                } else {
                    // Afficher un message si aucune donnée n'est disponible
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td colspan="4" class="px-6 py-4 text-center text-gray-500">
                            Aucune donnée de champion disponible
                        </td>
                    `;
                    championsStatsBody.appendChild(row);
                }

                // Mettre à jour le rôle principal
                const mainRoleElement = statsContent.querySelector('.player-main-role');
                mainRoleElement.textContent = playerData.stats.Role || 'N/A';

                this.statsContainer.appendChild(statsContent);
                resolve();
            }, 0);
        });
    }
}

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    const analyzer = new PlayerAnalyzer();
    analyzer.initialize();
});
