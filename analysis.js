// Sélection des éléments du DOM
const searchForm = document.getElementById('searchForm');
const gameNameInput = document.getElementById('gameName');
const tagLineInput = document.getElementById('tagLine');
const loadingDiv = document.getElementById('loading');
const loadingProgressBar = document.getElementById('loadingProgressBar');
const loadingStepText = document.getElementById('loadingStepText');
const loadingPercentage = document.getElementById('loadingPercentage');
const loadingDetailText = document.getElementById('loadingDetailText');
const analysisResult = document.getElementById('analysisResult');
const errorDiv = document.getElementById('error');
const strengthsList = document.getElementById('strengthsList');
const weaknessesList = document.getElementById('weaknessesList');
// ...autres sélections d'éléments...


// Configuration de l'API Riot
const RIOT_API_KEY = 'Mettre la clé API ici';
const REGION = 'europe'; // europe, asia, americas
const REGION_V5 = 'euw1'; // euw1, kr, na1, etc.

// Gestionnaire de taux de requêtes
class RateLimiter {
    constructor(requestsPerSecond, requestsPer2Minutes) {
        this.requestsPerSecond = requestsPerSecond;
        this.requestsPer2Minutes = requestsPer2Minutes;
        this.requestsThisSecond = 0;
        this.requestsThis2Minutes = 0;
        this.queue = [];
        this.lastReset = Date.now();
        this.last2MinReset = Date.now();
    }

    async executeRequest(requestFn) {
        const now = Date.now();
        
        // Réinitialiser les compteurs
        if (now - this.lastReset >= 1000) {
            this.requestsThisSecond = 0;
            this.lastReset = now;
        }
        if (now - this.last2MinReset >= 120000) {
            this.requestsThis2Minutes = 0;
            this.last2MinReset = now;
        }

        // Vérifier les limites
        if (this.requestsThisSecond >= this.requestsPerSecond || 
            this.requestsThis2Minutes >= this.requestsPer2Minutes) {
            await new Promise(resolve => setTimeout(resolve, 50));
            return this.executeRequest(requestFn);
        }

        // Exécuter la requête
        this.requestsThisSecond++;
        this.requestsThis2Minutes++;
        return requestFn();
    }
}

const rateLimiter = new RateLimiter(20, 100);

// Gestion de la soumission du formulaire
searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Récupération des valeurs saisies
    const gameName = gameNameInput.value.trim();
    const tagLine = tagLineInput.value.trim();

    // Validation des entrées
    if (!gameName || !tagLine) {
        errorDiv.textContent = 'Veuillez entrer un Game Name et un Tag Line valides.';
        errorDiv.classList.remove('hidden');
        return;
    }

    // Réinitialisation de l'interface
    errorDiv.classList.add('hidden');
    analysisResult.classList.add('hidden');
    loadingDiv.classList.remove('hidden');
    updateLoadingProgress(0, 'Initialisation...', 'Préparation de l\'analyse...');

    try {
        // Étape 1 : Récupération des informations du joueur et analyse
        updateLoadingProgress(10, 'Récupération des informations du joueur...', '');
        const playerData = await getPlayerData(gameName, tagLine);

        // Étape 2 : Analyse des données (directement depuis playerData)
        updateLoadingProgress(60, 'Analyse des données...', '');
        const analysisData = analyzeData(playerData);

        // Étape 3 : Mise à jour de l'interface utilisateur
        updateLoadingProgress(80, 'Mise à jour de l\'interface...', '');
        updateUI(playerData, analysisData);

        // Étape 5 : Finalisation
        updateLoadingProgress(100, 'Analyse complète!', '');
        loadingDiv.classList.add('hidden');
        analysisResult.classList.remove('hidden');

    } catch (error) {
        // Gestion des erreurs
        loadingDiv.classList.add('hidden');
        errorDiv.textContent = 'Une erreur est survenue : ' + error.message;
        errorDiv.classList.remove('hidden');
    }
});

// Fonction pour mettre à jour la progression du chargement
function updateLoadingProgress(percentage, stepText, detailText) {
    const loadingProgressBar = document.getElementById('loadingProgressBar');
    loadingProgressBar.style.width = percentage + '%';
    loadingProgressBar.textContent = percentage + '%';
    loadingPercentage.textContent = percentage + '%';
    loadingStepText.textContent = stepText;
    loadingDetailText.textContent = detailText;
}

// Fonction pour récupérer les informations du joueur
async function getPlayerData(gameName, tagLine) {
    try {
        // 1. Récupérer les informations du compte
        const accountResponse = await rateLimiter.executeRequest(() => 
            axios.get(
                `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
                { headers: { 'X-Riot-Token': RIOT_API_KEY } }
            )
        );

        // 2. Récupérer les IDs des 50 dernières parties
        const matchesResponse = await rateLimiter.executeRequest(() =>
            axios.get(
                `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${accountResponse.data.puuid}/ids`,
                {
                    headers: { 'X-Riot-Token': RIOT_API_KEY },
                    params: { start: 0, count: 50 }
                }
            )
        );

        // 3. Récupérer les détails des parties par lots de 5
        const matchData = [];
        const matchIds = matchesResponse.data;
        
        for (let i = 0; i < matchIds.length; i += 5) {
            const batch = matchIds.slice(i, i + 5);
            const batchPromises = batch.map(matchId =>
                rateLimiter.executeRequest(() =>
                    axios.get(
                        `https://${REGION}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
                        { headers: { 'X-Riot-Token': RIOT_API_KEY } }
                    )
                )
            );

            updateLoadingProgress(
                30 + (i / matchIds.length * 50),
                'Récupération des parties...',
                `Parties ${i + 1}-${Math.min(i + 5, matchIds.length)} sur ${matchIds.length}`
            );

            const batchResults = await Promise.all(batchPromises);
            matchData.push(...batchResults.map(response => response.data));

            // Pause entre les lots si nécessaire
            if (i + 5 < matchIds.length) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }

        const playerStats = analyzeMatchHistory(matchData, accountResponse.data.puuid);

        return {
            accountInfo: accountResponse.data,
            stats: playerStats
        };
    } catch (error) {
        console.error('Erreur API:', error);
        throw new Error('Impossible de récupérer les informations du joueur');
    }
}

function analyzeMatchHistory(matches, puuid) {
    const stats = {
        totalGames: matches.length,
        wins: 0,
        losses: 0,
        kda: { kills: 0, deaths: 0, assists: 0 },
        championStats: {},
        roleStats: {},
        goldDiffAt14: [],
        earlyGameStats: {
            gamesWithEarlyData: 0,
            winsWithAdvantage: 0,
            gamesWithAdvantage: 0,
            totalGoldDiff: 0
        },
        objectiveStats: {
            firstDragon: 0,
            firstHerald: 0,
            firstTower: 0,
            totalGames: 0 // Ajout d'un compteur de parties valides
        },
        gameDurations: {
            wins: [],
            losses: []
        }
    };

    matches.forEach(match => {
        const participant = match.info.participants.find(p => p.puuid === puuid);
        if (!participant) return;

        // Statistiques de base
        if (participant.win) {
            stats.wins++;
            stats.gameDurations.wins.push(match.info.gameDuration);
        } else {
            stats.losses++;
            stats.gameDurations.losses.push(match.info.gameDuration);
        }

        // KDA
        stats.kda.kills += participant.kills;
        stats.kda.deaths += participant.deaths;
        stats.kda.assists += participant.assists;

        // Gold diff à 14 minutes
        let goldAt14 = 0;
        let enemyGoldAt14 = 0;

        // Trouver l'adversaire direct (même rôle dans l'équipe adverse)
        const opponent = match.info.participants.find(p => 
            p.teamId !== participant.teamId && 
            p.teamPosition === participant.teamPosition
        );

        if (participant.challenges && participant.challenges.goldPerMinute) {
            // Calculer l'or à 14 minutes basé sur goldPerMinute
            goldAt14 = participant.challenges.goldPerMinute * 14;
            
            if (opponent && opponent.challenges && opponent.challenges.goldPerMinute) {
                enemyGoldAt14 = opponent.challenges.goldPerMinute * 14;
                const goldDiff = goldAt14 - enemyGoldAt14;
                
                stats.goldDiffAt14.push(goldDiff);
                stats.earlyGameStats.gamesWithEarlyData++;
                stats.earlyGameStats.totalGoldDiff += goldDiff;

                if (goldDiff > 0) {
                    stats.earlyGameStats.gamesWithAdvantage++;
                    if (participant.win) {
                        stats.earlyGameStats.winsWithAdvantage++;
                    }
                }
            }
        }

        // Champion stats avec calcul du WR
        const champion = participant.championName;
        if (!stats.championStats[champion]) {
            stats.championStats[champion] = {
                games: 0,
                wins: 0,
                kills: 0,
                deaths: 0,
                assists: 0,
                winRate: 0,
                kda: 0 // Ajout du KDA moyen
            };
        }
        if (participant.win) {
            stats.championStats[champion].wins++;
        }
        stats.championStats[champion].kills += participant.kills;
        stats.championStats[champion].deaths += participant.deaths;
        stats.championStats[champion].assists += participant.assists;
        stats.championStats[champion].winRate = (stats.championStats[champion].wins / stats.championStats[champion].games * 100).toFixed(2);

        // Role stats avec calcul du WR
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
        stats.roleStats[role].winRate = (stats.roleStats[role].wins / stats.roleStats[role].games * 100).toFixed(2);

        // Correction du calcul des objectifs
        if (match.info.teams) {
            // Trouver l'équipe du joueur (0 pour blue, 1 pour red)
            const teamIndex = participant.teamId === 100 ? 0 : 1;
            const team = match.info.teams[teamIndex];
            
            if (team && team.objectives) {
                stats.objectiveStats.totalGames++;
                if (team.objectives.dragon && team.objectives.dragon.first) {
                    stats.objectiveStats.firstDragon++;
                }
                if (team.objectives.riftHerald && team.objectives.riftHerald.first) {
                    stats.objectiveStats.firstHerald++;
                }
                if (team.objectives.tower && team.objectives.tower.first) {
                    stats.objectiveStats.firstTower++;
                }
            }
        }
    });

    // Calcul du KDA pour chaque champion
    Object.values(stats.championStats).forEach(champStats => {
        champStats.kda = ((champStats.kills + champStats.assists) / Math.max(1, champStats.deaths)).toFixed(2);
    });

    // Calculs finaux
    stats.winRate = (stats.wins / stats.totalGames * 100).toFixed(2);
    stats.kda.ratio = ((stats.kda.kills + stats.kda.assists) / Math.max(1, stats.kda.deaths)).toFixed(2);
    stats.averageGoldDiffAt14 = stats.goldDiffAt14.length > 0 
        ? (stats.earlyGameStats.totalGoldDiff / stats.earlyGameStats.gamesWithEarlyData).toFixed(0)
        : 0;
    
    stats.winRateWithAdvantage = stats.earlyGameStats.gamesWithAdvantage > 0
        ? ((stats.earlyGameStats.winsWithAdvantage / stats.earlyGameStats.gamesWithAdvantage) * 100).toFixed(1)
        : 0;

    // Trouver le champion le plus joué
    stats.mostPlayedChampion = Object.entries(stats.championStats)
        .sort((a, b) => b[1].games - a[1].games)[0];

    // Trouver le rôle principal
    stats.mainRole = Object.entries(stats.roleStats)
        .sort((a, b) => b[1].games - a[1].games)[0];

    return stats;
}

// Mettre à jour la fonction analyzeData pour utiliser les nouvelles statistiques
function analyzeData(playerData) {
    const stats = playerData.stats;
    const strengths = [];
    const weaknesses = [];

    // Analyse Win Rate
    const winRate = parseFloat(stats.winRate);
    if (winRate >= 55) {
        strengths.push({
            type: 'winrate',
            icon: 'trophy',
            color: 'yellow',
            text: `Win Rate exceptionnel (${winRate}%)`
        });
    } else if (winRate <= 45) {
        weaknesses.push({
            type: 'winrate',
            icon: 'chart-line-down',
            color: 'red',
            text: `Win Rate à améliorer (${winRate}%)`
        });
    }

    // Analyse KDA
    const kda = parseFloat(stats.kda.ratio);
    const avgDeaths = stats.kda.deaths / stats.totalGames;
    if (kda >= 3) {
        strengths.push({
            type: 'kda',
            icon: 'skull',
            color: 'green',
            text: `KDA excellent (${kda})`
        });
    } else if (kda <= 2) {
        weaknesses.push({
            type: 'kda',
            icon: 'skull-crossbones',
            color: 'red',
            text: `KDA faible (${kda})`
        });
    }
    if (avgDeaths < 4) {
        strengths.push({
            type: 'deaths',
            icon: 'shield',
            color: 'blue',
            text: `Très peu de morts (${avgDeaths.toFixed(1)} en moyenne)`
        });
    }

    // Analyse Early Game
    const goldDiff = parseFloat(stats.averageGoldDiffAt14);
    const winRateWithAdvantage = parseFloat(stats.winRateWithAdvantage);
    if (goldDiff >= 500) {
        strengths.push({
            type: 'early',
            icon: 'coins',
            color: 'yellow',
            text: `Dominant en early game (+${goldDiff} or@14)`
        });
    } else if (goldDiff <= -500) {
        weaknesses.push({
            type: 'early',
            icon: 'coins',
            color: 'red',
            text: `Difficultés en early game (${goldDiff} or@14)`
        });
    }

    // Analyse des objectifs
    const objectives = stats.objectiveStats;
    const totalGames = objectives.totalGames || 1;
    const drakeRate = (objectives.firstDragon / totalGames) * 100;
    const heraldRate = (objectives.firstHerald / totalGames) * 100;

    if (drakeRate >= 60) {
        strengths.push({
            type: 'objective',
            icon: 'dragon',
            color: 'purple',
            text: `Excellent contrôle des drakes (${drakeRate.toFixed(1)}%)`
        });
    }
    if (heraldRate >= 60) {
        strengths.push({
            type: 'objective',
            icon: 'fort',
            color: 'blue',
            text: `Priorité sur le Herald (${heraldRate.toFixed(1)}%)`
        });
    }

    // Analyse du champion principal
    if (stats.mostPlayedChampion) {
        const [champName, champStats] = stats.mostPlayedChampion;
        const champWinRate = parseFloat(champStats.winRate);
        if (champWinRate >= 55 && champStats.games >= 10) {
            strengths.push({
                type: 'champion',
                icon: 'crown',
                color: 'gold',
                text: `Maîtrise de ${champName} (${champWinRate}% WR sur ${champStats.games} parties)`
            });
        }
    }

    return {
        strengths,
        weaknesses,
        championStats: stats.championStats,
        roleStats: stats.roleStats,
        objectiveStats: stats.objectiveStats,
        generalStats: {
            winRate: stats.winRate,
            kda: stats.kda.ratio,
            totalGames: stats.totalGames,
            wins: stats.wins,
            losses: stats.losses,
            averageGoldDiffAt14: stats.averageGoldDiffAt14,
            mostPlayedChampion: stats.mostPlayedChampion,
            mainRole: stats.mainRole
        }
    };
}

// Fonction pour mettre à jour l'interface utilisateur
function formatGameDuration(duration) {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.round(duration % 60); // Arrondir les secondes
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getStatColor(value, type) {
    switch (type) {
        case 'winrate':
            if (value >= 60) return 'text-green-500 font-bold animate-pulse';
            if (value >= 55) return 'text-green-400 font-semibold';
            if (value <= 45) return 'text-red-500';
            return 'text-gray-600';
        case 'kda':
            if (value >= 4) return 'text-purple-500 font-bold animate-pulse';
            if (value >= 3) return 'text-purple-400 font-semibold';
            if (value <= 2) return 'text-red-500';
            return 'text-gray-600';
        case 'objective':
            if (value >= 70) return 'text-blue-500 font-bold animate-pulse';
            if (value >= 60) return 'text-blue-400 font-semibold';
            return 'text-gray-600';
        default:
            return 'text-gray-600';
    }
}

function updateUI(playerData, analysisData) {
    // Mise à jour des informations du joueur
    document.getElementById('playerLevel').textContent = `${playerData.accountInfo.gameName}#${playerData.accountInfo.tagLine}`;
    document.getElementById('winRate').textContent = `Win Rate: ${playerData.stats.winRate}%`;
    document.getElementById('winLoss').textContent = `${playerData.stats.wins} Victoires / ${playerData.stats.losses} Défaites`;

    // Mise à jour de l'icône du joueur
    const playerIcon = document.getElementById('playerIcon').querySelector('img');
    playerIcon.onerror = () => {
        playerIcon.src = '/images/default-icon.png'; // Assurez-vous d'avoir cette image dans votre dossier public
    };
    // Utiliser l'ID de l'icône du joueur depuis les données du compte
    const iconId = playerData.accountInfo.profileIconId || 1;
    playerIcon.src = `https://ddragon.leagueoflegends.com/cdn/14.23.1/img/profileicon/${iconId}.png`;

    // Mise à jour des statistiques détaillées
    // KDA et Win Rate
    document.getElementById('averageKDA').textContent = playerData.stats.kda.ratio;
    document.getElementById('goldDiffAt14').textContent = `${playerData.stats.averageGoldDiffAt14} or`;
    document.getElementById('winrateWithAdvantage').textContent = 
        playerData.stats.winRateWithAdvantage > 0 
            ? `${playerData.stats.winRateWithAdvantage}%` 
            : 'N/A';

    // Calcul et affichage des KDA détaillés
    const totalGames = playerData.stats.totalGames;
    const avgKills = (playerData.stats.kda.kills / totalGames).toFixed(2);
    const avgDeaths = (playerData.stats.kda.deaths / totalGames).toFixed(2);
    const avgAssists = (playerData.stats.kda.assists / totalGames).toFixed(2);
    
    document.getElementById('averageKDA').textContent = 
        `${avgKills}/${avgDeaths}/${avgAssists}`;
    document.getElementById('totalKDA').textContent = 
        `(${playerData.stats.kda.kills}/${playerData.stats.kda.deaths}/${playerData.stats.kda.assists})`;

    // Champion le plus joué
    const mostPlayed = playerData.stats.mostPlayedChampion;
    if (mostPlayed) {
        document.getElementById('favoriteChamp').textContent = mostPlayed[0];
        document.getElementById('favoriteChampWR').textContent = `${mostPlayed[1].winRate}%`;
    }

    // Rôle principal
    const mainRole = playerData.stats.mainRole;
    if (mainRole) {
        document.getElementById('mainRole').textContent = mainRole[0];
        document.getElementById('bestRoleWR').textContent = `${mainRole[1].winRate}%`;
    }

    // Objectifs
    const objectives = playerData.stats.objectiveStats;

    // Calcul des pourcentages avec 1 décimale
    const drakeRate = ((objectives.firstDragon / totalGames) * 100).toFixed(1);
    const heraldRate = ((objectives.firstHerald / totalGames) * 100).toFixed(1);
    const towerRate = ((objectives.firstTower / totalGames) * 100).toFixed(1);

    // Mise à jour de l'interface
    document.getElementById('firstDrakeRate').textContent = `${drakeRate}%`;
    document.getElementById('firstHeraldRate').textContent = `${heraldRate}%`;
    document.getElementById('firstVoidgrubRate').textContent = `${towerRate}%`;

    // Durée moyenne des parties
    const avgWinDuration = playerData.stats.gameDurations.wins.reduce((a, b) => a + b, 0) / playerData.stats.wins;
    const avgLossDuration = playerData.stats.gameDurations.losses.reduce((a, b) => a + b, 0) / playerData.stats.losses;
    
    document.getElementById('averageWinDuration').textContent = formatGameDuration(avgWinDuration);
    document.getElementById('averageLossDuration').textContent = formatGameDuration(avgLossDuration);

    // Points forts et faibles
    strengthsList.innerHTML = '';
    analysisData.strengths.forEach(strength => {
        const li = document.createElement('li');
        li.classList.add('flex', 'items-start', 'mb-2');
        li.innerHTML = `
            <i class="fas fa-${strength.icon} text-${strength.color}-500 mt-1 mr-2"></i>
            <div>
                <span class="font-medium">${strength.text}</span>
            </div>
        `;
        strengthsList.appendChild(li);
    });

    weaknessesList.innerHTML = '';
    analysisData.weaknesses.forEach(weakness => {
        const li = document.createElement('li');
        li.classList.add('flex', 'items-start', 'mb-2');
        li.innerHTML = `
            <i class="fas fa-${weakness.icon} text-${weakness.color}-500 mt-1 mr-2"></i>
            <div>
                <span class="font-medium">${weakness.text}</span>
            </div>
        `;
        weaknessesList.appendChild(li);
    });

    // Ajouter la section KDA par champion
    const container = document.getElementById('categoryChampionsStats');
    const kdaSection = document.createElement('div');
    kdaSection.className = 'mb-6';
    
    // Créer l'en-tête de la section
    kdaSection.innerHTML = `
        <h4 class="text-lg font-semibold mb-3 text-purple-600">
            <i class="fas fa-crosshairs mr-2"></i>
            KDA par Champion
        </h4>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" id="championsKDA">
        </div>
    `;
    
    container.appendChild(kdaSection);
    
    // Trier les champions par KDA
    const sortedChampions = Object.entries(analysisData.championStats)
        .filter(([, stats]) => stats.games >= 3) // Filtrer les champions avec au moins 3 parties
        .sort((a, b) => parseFloat(b[1].kda) - parseFloat(a[1].kda));
    
    const championsKDAContainer = document.getElementById('championsKDA');
    sortedChampions.forEach(([champion, stats]) => {
        const championCard = document.createElement('div');
        championCard.className = 'p-3 bg-gray-50 rounded-lg shadow-sm';
        championCard.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="font-medium">${champion}</span>
                <span class="text-purple-600 font-semibold">${stats.kda}</span>
            </div>
            <div class="text-xs text-gray-500">${stats.games} parties</div>
        `;
        championsKDAContainer.appendChild(championCard);
    });


    // Ajouter chaque champion et son KDA
    sortedChampions.forEach(([champion, stats]) => {
        const championElement = document.createElement('div');
        championElement.className = 'flex justify-between items-center p-2 border-b border-gray-200';
        championElement.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="font-medium">${champion}</span>
                <span class="text-xs text-gray-500">(${stats.games} parties)</span>
            </div>
            <span class="text-purple-600 font-bold">${parseFloat(stats.kda).toFixed(2)}</span>
        `;
        championsKDAContainer.appendChild(championElement);
    });

    // Mise à jour des graphiques
    generateCharts(analysisData);

    // Gestion du filtrage par catégorie
    const categoryFilter = document.getElementById('categoryFilter');
    categoryFilter.addEventListener('change', () => {
        const selectedCategory = categoryFilter.value;
        document.querySelectorAll('.category-group').forEach(group => {
            if (selectedCategory === 'all' || group.id.includes(selectedCategory)) {
                group.classList.remove('hidden');
            } else {
                group.classList.add('hidden');
            }
        });
    });
}

// Modifier la fonction generateCharts pour utiliser les données correctement
function generateCharts(analysisData) {
    // Graphique des Win Rates et Games Played par Champion
    const ctxChampions = document.getElementById('championsChart').getContext('2d');
    const championData = Object.entries(analysisData.championStats)
        .sort((a, b) => b[1].games - a[1].games) // Trier par nombre de parties
        .slice(0, 10); // Limiter aux 10 champions les plus joués
    
    new Chart(ctxChampions, {
        type: 'bar',
        data: {
            labels: championData.map(([name]) => name),
            datasets: [
                {
                    label: 'Parties jouées',
                    data: championData.map(([, stats]) => stats.games),
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    order: 2,
                    yAxisID: 'y-games'
                },
                {
                    label: 'Win Rate (%)',
                    data: championData.map(([, stats]) => parseFloat(stats.winRate)),
                    type: 'line',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    borderWidth: 2,
                    fill: false,
                    order: 1,
                    yAxisID: 'y-winrate'
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                'y-games': {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Nombre de parties'
                    },
                    beginAtZero: true,
                    grid: {
                        drawOnChartArea: false
                    }
                },
                'y-winrate': {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Win Rate (%)'
                    },
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        drawOnChartArea: false
                    }
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: 'Performance par Champion (Top 10 les plus joués)'
                },
                legend: {
                    position: 'top'
                }
            }
        }
    });

    // Graphique de répartition par Rôle (reste inchangé)
    const ctxRoles = document.getElementById('rolesChart').getContext('2d');
    const roleData = Object.entries(analysisData.roleStats);

    new Chart(ctxRoles, {
        type: 'pie',
        data: {
            labels: roleData.map(([role]) => role),
            datasets: [{
                data: roleData.map(([, stats]) => stats.games),
                backgroundColor: [
                    'rgba(255, 99, 132, 0.6)',
                    'rgba(54, 162, 235, 0.6)',
                    'rgba(255, 206, 86, 0.6)',
                    'rgba(75, 192, 192, 0.6)',
                    'rgba(153, 102, 255, 0.6)'
                ]
            }]
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: 'Répartition des parties par rôle'
                }
            }
        }
    });
}

// Gestion du filtrage par catégorie
const categoryFilter = document.getElementById('categoryFilter');
categoryFilter.addEventListener('change', () => {
    const selectedCategory = categoryFilter.value;
    document.querySelectorAll('.category-group').forEach(group => {
        if (selectedCategory === 'all' || group.id.includes(selectedCategory)) {
            group.classList.remove('hidden');
        } else {
            group.classList.add('hidden');
        }
    });
});