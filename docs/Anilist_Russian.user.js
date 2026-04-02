// ==UserScript==
// @name         AniList Russian
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @description  Перевод AniList на русский
// @author       Jollan
// @match        https://anilist.co/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @connect      raw.githubusercontent.com
// @connect      shikimori.io
// @connect      shikimori.one
// @connect      shikimori.me
// @connect      shikimori.fi
// @connect      shikimori.rip
// @connect      graphql.anilist.co
// @license      MIT
// @updateURL https://jollanxd.github.io/Translat/Anilist_Russian.user.js
// @downloadURL https://jollanxd.github.io/Translat/Anilist_Russian.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. КОНФИГУРАЦИЯ ---
    const DICT_URL = 'https://raw.githubusercontent.com/JollanXD/Translat/refs/heads/main/Dictionary.json';
    const CACHE_TIME = 24 * 60 * 60 * 1000;
    const SHIKI_DOMAINS =['shikimori.io', 'shikimori.one', 'shikimori.me', 'shikimori.rip', 'shikimori.fi'];

    let dictionary = {};
    const settings = {
        translateTitles: GM_getValue('set_titles', true),
        translateDescriptions: GM_getValue('set_desc', true),
        translateCharacters: GM_getValue('set_chars', true),
        translateStaff: GM_getValue('set_staff', true)
    };

    const monthsFull = { Jan: 'января', Feb: 'февраля', Mar: 'марта', Apr: 'апреля', May: 'мая', Jun: 'июня', Jul: 'июля', Aug: 'августа', Sep: 'сентября', Oct: 'октября', Nov: 'ноября', Dec: 'декабря' };
    const days = { Mon: 'Пн', Tue: 'Вт', Wed: 'Ср', Thu: 'Чт', Fri: 'Пт', Sat: 'Сб', Sun: 'Вс' };
    const seasons = { Winter: 'Зима', Spring: 'Весна', Summer: 'Лето', Fall: 'Осень' };

    // --- 2. ИНИЦИАЛИЗАЦИЯ ---
    async function init() {
        createSettingsUI();
        dictionary = await loadDictionary();
        translateDOM(document.body);
        if (settings.translateTitles || settings.translateDescriptions || settings.translateCharacters || settings.translateStaff) {
            debouncedFindContent();
        }
        setupObserver();
    }

    async function loadDictionary() {
        const lastUpdate = GM_getValue('dict_last_update_v4', 0);
        const cachedDict = GM_getValue('ru_dict_v4', null);
        if (cachedDict && (Date.now() - lastUpdate < CACHE_TIME)) return JSON.parse(cachedDict);

        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET", url: DICT_URL, onload: (res) => {
                    if (res.status === 200) {
                        try {
                            const dict = JSON.parse(res.responseText);
                            GM_setValue('ru_dict_v4', JSON.stringify(dict));
                            GM_setValue('dict_last_update_v4', Date.now());
                            resolve(dict);
                        } catch (e) { resolve(cachedDict ? JSON.parse(cachedDict) : {}); }
                    } else resolve(cachedDict ? JSON.parse(cachedDict) : {});
                }
            });
        });
    }

    // --- 3. ЛОГИКА ПЕРЕВОДА ---
    function getPlural(n, forms) {
        return (n % 10 === 1 && n % 100 !== 11 ? forms[0] : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? forms[1] : forms[2]));
    }

    function cleanShikiBB(text) {
        if (!text) return "";
        return text
            .replace(/\[i\](.*?)\[\/i\]/gi, '<i>$1</i>').replace(/\[b\](.*?)\[\/b\]/gi, '<b>$1</b>').replace(/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>')
            .replace(/\[\w+=\d+\](.*?)\[\/\w+\]/gi, '$1').replace(/\[\w+(=.*?)?\]/gi, '').replace(/\[\/\w+\]/gi, '').replace(/\n/g, '<br>');
    }

    function translateAdvanced(text) {
        if (!text) return null;
        const cleanText = text.replace(/\s+/g, ' ').trim();

        if (dictionary[cleanText]) return dictionary[cleanText];

        // 1. УМНЫЕ РАЗДЕЛИТЕЛИ
        if (cleanText.includes(' · ')) {
            return cleanText.split(' · ').map(p => {
                const part = p.trim();
                return dictionary[part] || translateAdvanced(part) || part;
            }).join(' · ');
        }

        // 2. РОЛИ СЕРСОНАЛА В СКОБКАХ
        const roleMatch = cleanText.match(/^(.+?)\s*\((.+)\)$/);
        if (roleMatch) {
            let roleName = roleMatch[1].trim();
            let roleInfo = roleMatch[2].trim();
            let trRole = dictionary[roleName] || roleName;
            let trInfo = roleInfo.replace(/\beps?\b/gi, 'сер.').replace(/\bOP\b/gi, 'OP').replace(/\bED\b/gi, 'ED');
            return `${trRole} (${trInfo})`;
        }

        // 3. НОМИНАЦИИ / РЕЙТИНГИ
        const rankingMatch = cleanText.match(/^#(\d+)\s+(highest\s+rated|most\s+popular)\s+all\s+time$/i);
        if (rankingMatch) {
            const rank = rankingMatch[1];
            const type = rankingMatch[2].toLowerCase();
            return `#${rank} ${type === 'highest rated' ? 'в рейтинге' : 'по популярности'} за всё время`;
        }

        // 4. КОМПЛЕКСНОЕ ВРЕМЯ (Восстановлено!)
        const timeComplexMatch = cleanText.match(/^(\d+\s+\w+)\s+(\d+\s+\w+)$/i);
        if (timeComplexMatch) {
            const p1 = translateAdvanced(timeComplexMatch[1]);
            const p2 = translateAdvanced(timeComplexMatch[2]);
            if (p1 && p2) return `${p1} ${p2}`;
        }

        // 5. РОСТ
        const heightMatch = cleanText.match(/^(?:Height:\s+)?([\d\s\.,\-–—]+)\s*cm(?:\s*\((.*?)\))?$/i);
        if (heightMatch) {
            const cm = heightMatch[1].trim();
            const ft = heightMatch[2] ? ` (${heightMatch[2]})` : '';
            return `${cm} см${ft}`;
        }

        // 6. ОТЗЫВЫ
        const likedMatch = cleanText.match(/^(\d+)\s+out\s+of\s+(\d+)\s+(?:users?\s+)?liked\s+this\s+review$/i);
        if (likedMatch) return `${likedMatch[1]} из ${likedMatch[2]} оценили этот отзыв`;

        // 7. ДАТЫ С ГОДОМ
        const dateFullMatch = cleanText.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})$/i);
        if (dateFullMatch) return `${dateFullMatch[2]} ${monthsFull[dateFullMatch[1]]} ${dateFullMatch[3]} г.`;

        // 8. ДЕНЬ РОЖДЕНИЯ (Восстановлено!)
        const bdayMatch = cleanText.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:,)?\s+(\d{1,4})$/i);
        if (bdayMatch) {
            const m = monthsFull[bdayMatch[1]];
            const val = bdayMatch[2];
            return val.length > 2 ? `${m} ${val} г.` : `${val} ${m}`;
        }

        // 9. СЕЗОН И ГОД
        const seasonMatch = cleanText.match(/^(Winter|Spring|Summer|Fall)\s+(\d{4})$/i);
        if (seasonMatch) return `${seasons[seasonMatch[1]]} ${seasonMatch[2]}`;

        // 10. АКТИВНОСТЬ
        const actMatch = cleanText.match(/^(Watched|Rewatched|Read|Reread)\s+(episode|chapter)\s+([\d\s\-–—]+)\s+of$/i);
        if (actMatch) {
            const isRange = actMatch[3].includes('-') || actMatch[3].includes('–');
            const aRu = { watched: isRange ? 'Просмотрены' : 'Просмотрена', rewatched: isRange ? 'Пересмотрены' : 'Пересмотрена', read: isRange ? 'Прочитаны' : 'Прочитана', reread: isRange ? 'Перечитаны' : 'Перечитана' };
            const tRu = { episode: isRange ? 'серии' : 'серия', chapter: isRange ? 'главы' : 'глава' };
            return `${aRu[actMatch[1].toLowerCase()]} ${tRu[actMatch[2].toLowerCase()]} ${actMatch[3].trim()}`;
        }

        // 11. МЕТКИ
        const labelMatch = cleanText.match(/^(Format|Status|Country|Chapters|Score|Count|Hours Watched|Mean Score|Chapters Read|Episodes|Released|Started|Amount|Progress|Finish Date|Birthday|Height|Age|Gender|Blood Type|Blood type|Occupation|Affiliation|Grade):\s*(.*)$/i);
        if (labelMatch) {
            const labels = {
                'Format': 'Формат', 'Status': 'Статус', 'Country': 'Страна', 'Chapters': 'Главы', 'Score': 'Оценка',
                'Count': 'Количество', 'Hours Watched': 'Часов просмотрено', 'Mean Score': 'Средний балл',
                'Chapters Read': 'Глав прочитано', 'Episodes': 'Серии', 'Released': 'Выпущено', 'Started': 'Начато',
                'Amount': 'Всего', 'Progress': 'Прогресс', 'Finish Date': 'Дата завершения', 'Birthday': 'День рождения',
                'Height': 'Рост', 'Age': 'Возраст', 'Gender': 'Пол', 'Blood Type': 'Группа крови', 'Blood type': 'Группа крови',
                'Occupation': 'Род занятий', 'Affiliation': 'Принадлежность', 'Grade': 'Ранг'
            };
            const label = labels[labelMatch[1]];
            const value = labelMatch[2].trim();
            const trValue = dictionary[value] || translateAdvanced(value) || value;
            return `${label}: ${trValue}`;
        }

        // 12. ПРОСТОЕ ВРЕМЯ / СЧЕТЧИКИ
        const unitMatch = cleanText.match(/^(\d+)\s+(day|hour|hr|minute|min|mins|sec|episode|chapter|volume|reply|user)s?$/i);
        if (unitMatch) {
            const num = parseInt(unitMatch[1]);
            const unit = unitMatch[2].toLowerCase();
            const f = {
                day: ['день', 'дня', 'дней'], hour:['час', 'часа', 'часов'], hr: ['час', 'часа', 'часов'],
                minute: ['минуту', 'минуты', 'минут'], min:['минуту', 'минуты', 'минут'], mins:['минуту', 'минуты', 'минут'],
                sec: ['секунду', 'секунды', 'секунд'], episode:['серия', 'серии', 'серий'],
                chapter:['глава', 'главы', 'глав'], volume: ['том', 'тома', 'томов'],
                reply:['ответ', 'ответа', 'ответов'], user: ['пользователь', 'пользователя', 'пользователей']
            };
            return `${num} ${getPlural(num, f[unit])}`;
        }

        // 13. ПОПУЛЯРНОСТЬ (Восстановлено!)
        const recentMatch = cleanText.match(/^(\d+)\s+recently\s+(watched|read)$/i);
        if (recentMatch) return `${recentMatch[1]} недавно ${recentMatch[2] === 'watched' ? 'смотрели' : 'читали'}`;

        // 14. ПОЛНЫЕ ДАТЫ (Восстановлено!)
        const dayDateMatch = cleanText.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})$/i);
        if (dayDateMatch) return `${days[dayDateMatch[1]]}, ${dayDateMatch[3]} ${monthsFull[dayDateMatch[2]]} ${dayDateMatch[4]} г.`;

        // 15. ВРЕМЯ НАЗАД
        const agoMatch = cleanText.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);
        if (agoMatch) {
            const units = { second:['секунду', 'секунды', 'секунд'], minute:['минуту', 'минуты', 'минут'], hour:['час', 'часа', 'часов'], day:['день', 'дня', 'дней'], week:['неделю', 'недели', 'недель'], month: ['месяц', 'месяца', 'месяцев'], year:['год', 'года', 'лет'] };
            return `${agoMatch[1]} ${getPlural(parseInt(agoMatch[1]), units[agoMatch[2].toLowerCase()])} назад`;
        }

        return null;
    }

    function translateDOM(node) {
        if (!node) return;
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) return;['placeholder', 'label', 'value', 'title', 'aria-label'].forEach(attr => {
                const val = node.getAttribute(attr);
                if (val) {
                    const tr = translateAdvanced(val);
                    if (tr && val !== tr) {
                        node.setAttribute(attr, tr);
                        if (attr === 'value' && ('value' in node)) node.value = tr;
                    }
                }
            });
            if ((node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') && node.value) {
                const trValue = translateAdvanced(node.value);
                if (trValue && node.value !== trValue) node.value = trValue;
            }
            node.childNodes.forEach(translateDOM);
        } else if (node.nodeType === Node.TEXT_NODE) {
            const clean = node.nodeValue.trim();
            if (clean) {
                const tr = translateAdvanced(clean);
                if (tr && node.nodeValue.trim() !== tr) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), tr);
            }
        }
    }

    // --- 4. МОДУЛЬ ШИКИМОРИ ---
    const queue = new Map();
    const pending = { MED2: new Set(), CHR2: new Map(), STF3: new Map() };
    let isProcessing = false;

    function findAndQueueContent() {
        if (!settings.translateTitles && !settings.translateDescriptions && !settings.translateCharacters && !settings.translateStaff) return;

        document.querySelectorAll('a[href^="/anime/"], a[href^="/manga/"], a[href^="/character/"], a[href^="/staff/"]').forEach(link => {
            if (link.dataset.translated || link.querySelector('img') || link.closest('.nav')) return;

            const href = link.getAttribute('href');
            const isMedia = href.startsWith('/anime/') || href.startsWith('/manga/');

            if (isMedia && (link.classList.contains('relation-title') || link.closest('.relations') || link.closest('.role'))) return;

            const partsLen = href.split('/').filter(p=>p).length;

            if (settings.translateTitles || settings.translateDescriptions) {
                const matchMedia = href.match(/\/(anime|manga)\/(\d+)/);
                if (matchMedia && partsLen <= 3) {
                    addToQueue(matchMedia[2], 'MED2', link);
                    return;
                }
            }

            if (settings.translateCharacters) {
                const matchChar = href.match(/\/character\/(\d+)\/([^/]+)/);
                if (matchChar && partsLen <= 3) {
                    addToQueue(matchChar[1], 'CHR2', link, false, matchChar[2]);
                    return;
                }
            }

            if (settings.translateStaff) {
                const matchStaff = href.match(/\/staff\/(\d+)\/([^/]+)/);
                if (matchStaff && partsLen <= 3) {
                    addToQueue(matchStaff[1], 'STF3', link, false, matchStaff[2]);
                    return;
                }
            }
        });

        const currentUrl = location.href;

        if (settings.translateTitles || settings.translateDescriptions) {
            const pageMedia = currentUrl.match(/\/(anime|manga)\/(\d+)/);
            if (pageMedia) {
                const h1 = document.querySelector('.header .content h1');
                if (h1 && !h1.dataset.translated) addToQueue(pageMedia[2], 'MED2', h1, true);
                const desc = document.querySelector('.description');
                if (desc && !desc.dataset.translated) addToQueue(pageMedia[2], 'MED2', desc);
            }
        }

        if (settings.translateCharacters) {
            const pageChar = currentUrl.match(/\/character\/(\d+)\/([^/]+)/);
            if (pageChar) {
                const h1 = document.querySelector('.header .names h1.name, .header h1.name, .header .content h1');
                if (h1 && !h1.dataset.translated) addToQueue(pageChar[1], 'CHR2', h1, true, pageChar[2]);
                const desc = document.querySelector('.description');
                if (desc && !desc.dataset.translated) addToQueue(pageChar[1], 'CHR2', desc, false, pageChar[2]);
            }
        }

        if (settings.translateStaff) {
            const pageStaff = currentUrl.match(/\/staff\/(\d+)\/([^/]+)/);
            if (pageStaff) {
                const h1 = document.querySelector('.header .names h1.name, .header h1.name, .header .content h1');
                if (h1 && !h1.dataset.translated) addToQueue(pageStaff[1], 'STF3', h1, true, pageStaff[2]);
                const desc = document.querySelector('.description');
                if (desc && !desc.dataset.translated) addToQueue(pageStaff[1], 'STF3', desc, false, pageStaff[2]);
            }
        }
    }

    function addToQueue(id, type, element, isH1 = false, urlName = null) {
        const key = `${type}_${id}`;
        if (!queue.has(key)) queue.set(key,[]);
        queue.get(key).push({ element, isH1 });

        const cTitle = GM_getValue(`${type}_t_${id}`, null);
        const cDesc = GM_getValue(`${type}_d_${id}`, null);

        if (cTitle === 'NOT_FOUND') return;

        if (cTitle || cDesc) applyShikiData(type, id, { russian: cTitle, description: cDesc });
        else {
            if (type === 'MED2') pending.MED2.add(id);
            else if (type === 'CHR2') pending.CHR2.set(id, urlName);
            else if (type === 'STF3') pending.STF3.set(id, urlName);

            if (!isProcessing) { isProcessing = true; setTimeout(processQueue, 600); }
        }
    }

    function applyShikiData(type, id, data) {
        const items = queue.get(`${type}_${id}`);
        if (!items || !data || data.russian === 'NOT_FOUND') return;

        items.forEach(item => {
            if (item.isH1 && data.russian) {
                item.element.innerText = data.russian;
                document.title = `${data.russian} · AniList`;
            } else if (item.element.classList.contains('description') && data.description) {
                if (!item.element.querySelector('.ru-description')) {
                    const origHTML = item.element.innerHTML;
                    item.element.innerHTML = `
                        <div class="ru-description" style="margin-bottom: 20px;">${data.description}</div>
                        <details class="al-orig-desc" style="opacity: 0.85; font-size: 0.9em; background: rgba(128, 128, 128, 0.15); padding: 10px; border-radius: 5px;">
                            <summary style="cursor: pointer; color: #3dbbee; font-weight: bold; outline: none;">Оригинальное описание (AniList)</summary>
                            <div style="margin-top: 10px;">${origHTML}</div>
                        </details>
                    `;
                }
            } else if (data.russian) {
                for (let n of item.element.childNodes) {
                    if (n.nodeType === 3 && n.nodeValue.trim().length > 0) {
                        n.nodeValue = data.russian;
                        break;
                    }
                }
                if (item.element.hasAttribute('title')) item.element.setAttribute('title', data.russian);
                if (item.element.hasAttribute('aria-label')) item.element.setAttribute('aria-label', data.russian);
            }
            item.element.dataset.translated = "true";
        });
    }

    async function processQueue() {
        if (pending.MED2.size > 0) {
            const ids = Array.from(pending.MED2).slice(0, 40);
            ids.forEach(id => pending.MED2.delete(id));
            const malMap = await fetchAniListMalIds(ids);
            for (const id of ids) {
                if (malMap[id] && malMap[id].idMal) {
                    const data = await fetchShikiData(malMap[id].idMal, malMap[id].type);
                    if (data.russian) {
                        GM_setValue(`MED2_t_${id}`, data.russian);
                        if (data.description) GM_setValue(`MED2_d_${id}`, data.description);
                        applyShikiData('MED2', id, data);
                    } else GM_setValue(`MED2_t_${id}`, 'NOT_FOUND');
                } else GM_setValue(`MED2_t_${id}`, 'NOT_FOUND');
                await new Promise(r => setTimeout(r, 250));
            }
        } else if (pending.CHR2.size > 0) {
            const ids = Array.from(pending.CHR2.keys()).slice(0, 5);
            for (const id of ids) {
                const nameStr = pending.CHR2.get(id);
                pending.CHR2.delete(id);
                if (nameStr) {
                    const data = await fetchShikiPersonREST('characters', nameStr);
                    if (data.russian) {
                        GM_setValue(`CHR2_t_${id}`, data.russian);
                        if (data.description) GM_setValue(`CHR2_d_${id}`, data.description);
                        applyShikiData('CHR2', id, data);
                    } else GM_setValue(`CHR2_t_${id}`, 'NOT_FOUND');
                }
                await new Promise(r => setTimeout(r, 400));
            }
        } else if (pending.STF3.size > 0) {
            const ids = Array.from(pending.STF3.keys()).slice(0, 5);
            for (const id of ids) {
                const nameStr = pending.STF3.get(id);
                pending.STF3.delete(id);
                if (nameStr) {
                    const data = await fetchShikiPersonREST('people', nameStr);
                    if (data.russian) {
                        GM_setValue(`STF3_t_${id}`, data.russian);
                        if (data.description) GM_setValue(`STF3_d_${id}`, data.description);
                        applyShikiData('STF3', id, data);
                    } else GM_setValue(`STF3_t_${id}`, 'NOT_FOUND');
                }
                await new Promise(r => setTimeout(r, 400));
            }
        }

        if (pending.MED2.size > 0 || pending.CHR2.size > 0 || pending.STF3.size > 0) setTimeout(processQueue, 500);
        else isProcessing = false;
    }

    async function searchShiki(domain, endpoint, queryStr) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `https://${domain}/api/${endpoint}/search?search=${encodeURIComponent(queryStr)}`,
                onload: (r) => {
                    if (r.status === 200) {
                        try {
                            let res = JSON.parse(r.responseText);
                            if (res && res.length > 0) resolve(res[0]);
                            else reject();
                        } catch(e) { reject(); }
                    } else reject();
                },
                onerror: reject
            });
        }).catch(() => {
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: `https://${domain}/api/${endpoint}?search=${encodeURIComponent(queryStr)}`,
                    onload: (r) => {
                        if (r.status === 200) {
                            try {
                                let res = JSON.parse(r.responseText);
                                if (res && res.length > 0) resolve(res[0]);
                                else resolve(null);
                            } catch(e) { resolve(null); }
                        } else resolve(null);
                    },
                    onerror: () => resolve(null)
                });
            });
        });
    }

    async function fetchShikiPersonREST(endpointStr, searchName) {
        let nameParts = searchName.replace(/_/g, ' ').replace(/-/g, ' ').trim().split(' ').slice(0, 2);
        let directName = nameParts.join(' ');
        let reversedName = [...nameParts].reverse().join(' ');

        for (const domain of SHIKI_DOMAINS) {
            try {
                let item = await searchShiki(domain, endpointStr, directName);

                if (!item && nameParts.length > 1) {
                    item = await searchShiki(domain, endpointStr, reversedName);
                }

                if (!item) {
                    const gqlQuery = `query($search: String) { ${endpointStr}(search: $search, limit: 1) { id russian } }`;
                    item = await new Promise((resolve) => {
                        GM_xmlhttpRequest({
                            method: "POST",
                            url: `https://${domain}/api/graphql`,
                            headers: { "Content-Type": "application/json", "Accept": "application/json" },
                            data: JSON.stringify({ query: gqlQuery, variables: { search: directName } }),
                            onload: (r) => {
                                if (r.status === 200) {
                                    try {
                                        let res = JSON.parse(r.responseText);
                                        if (res.data && res.data[endpointStr] && res.data[endpointStr].length > 0) {
                                            resolve(res.data[endpointStr][0]);
                                        } else resolve(null);
                                    } catch(e) { resolve(null); }
                                } else resolve(null);
                            },
                            onerror: () => resolve(null)
                        });
                    });
                }

                if (item && item.id) {
                    const detailsRes = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: "GET",
                            url: `https://${domain}/api/${endpointStr}/${item.id}`,
                            onload: (r) => r.status === 200 ? resolve(JSON.parse(r.responseText)) : reject(),
                            onerror: reject
                        });
                    }).catch(() => null);

                    if (detailsRes) {
                        const url = `https://${domain}${detailsRes.url}`;
                        const footer = `<br><br><small style="opacity:0.75; font-size: 0.85em;">Описание предоставлено <a href="${url}" target="_blank" style="color:#3dbbee; text-decoration:none; font-weight:bold;">Shikimori</a></small>`;
                        return { russian: detailsRes.russian || item.russian, description: detailsRes.description ? cleanShikiBB(detailsRes.description) + footer : null };
                    } else {
                        return { russian: item.russian, description: null };
                    }
                }
            } catch (e) {
                // Идем к следующему домену
            }
        }
        return { russian: null, description: null };
    }

    function fetchAniListMalIds(ids) {
        return new Promise((resolve) => {
            const query = `query ($ids:[Int]) { Page { media(id_in: $ids) { id type idMal } } }`;
            GM_xmlhttpRequest({
                method: "POST", url: "https://graphql.anilist.co", headers: { "Content-Type": "application/json" },
                data: JSON.stringify({ query, variables: { ids: ids.map(i => parseInt(i)) } }),
                onload: (res) => {
                    const map = {};
                    try {
                        JSON.parse(res.responseText).data.Page.media.forEach(m => {
                            if (m.idMal) map[m.id] = { idMal: m.idMal, type: m.type };
                        });
                    } catch(e){}
                    resolve(map);
                }, onerror: () => resolve({})
            });
        });
    }

    async function fetchShikiData(malId, type) {
        const endpoint = type === 'MANGA' ? 'mangas' : 'animes';
        for (const domain of SHIKI_DOMAINS) {
            try {
                const res = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET", url: `https://${domain}/api/${endpoint}/${malId}`,
                        onload: (r) => r.status === 200 ? resolve(JSON.parse(r.responseText)) : reject()
                    });
                });
                const url = `https://${domain}${res.url}`;
                const footer = `<br><br><small style="opacity:0.75; font-size: 0.85em;">Описание предоставлено <a href="${url}" target="_blank" style="color:#3dbbee; text-decoration:none; font-weight:bold;">Shikimori</a></small>`;
                return { russian: res.russian, description: cleanShikiBB(res.description) + footer };
            } catch (e) {}
        }
        return { russian: null, description: null };
    }

    // --- 5. СИСТЕМНЫЕ ФУНКЦИИ ---
    let scanTimeout;
    function debouncedFindContent() { clearTimeout(scanTimeout); scanTimeout = setTimeout(findAndQueueContent, 300); }

    function setupObserver() {
        const observer = new MutationObserver((mutations) => {
            let changed = false;
            mutations.forEach((m) => {
                if (m.addedNodes.length) { m.addedNodes.forEach(node => translateDOM(node)); changed = true; }
                if (m.type === 'characterData' || (m.type === 'attributes' &&['title', 'aria-label', 'placeholder', 'value'].includes(m.attributeName))) { translateDOM(m.target); changed = true; }
            });
            if (changed) debouncedFindContent();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    }

    function createSettingsUI() {
        GM_addStyle(`
            #al-ru-settings-btn { position: fixed; bottom: 20px; right: 20px; z-index: 9999; background: #3dbbee; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-weight: bold; box-shadow: 0 2px 10px rgba(0,0,0,0.3); }
            #al-ru-panel { position: fixed; bottom: 70px; right: 20px; z-index: 9999; background: #151f2e; border-radius: 10px; padding: 15px; width: 220px; color: #9fadbd; box-shadow: 0 5px 20px rgba(0,0,0,0.5); display: none; font-family: sans-serif; }
            #al-ru-panel h3 { margin: 0 0 10px 0; font-size: 14px; color: #3dbbee; text-transform: uppercase; }
            .al-ru-opt { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 13px; }
            .al-ru-btn-clear { background: #e35d5d; color: white; border: none; padding: 7px 10px; border-radius: 5px; cursor: pointer; font-size: 11px; width: 100%; margin-top: 5px; font-weight: bold; }
        `);
        const btn = document.createElement('div');
        btn.id = 'al-ru-settings-btn'; btn.innerText = 'RU';
        btn.onclick = () => { const p = document.getElementById('al-ru-panel'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; };
        document.body.appendChild(btn);
        const panel = document.createElement('div');
        panel.id = 'al-ru-panel';
        panel.innerHTML = `
            <h3>Перевод AniList</h3>
            <div class="al-ru-opt"><span>Тайтлы (Shiki)</span><input type="checkbox" id="al-ru-set-titles" ${settings.translateTitles ? 'checked' : ''}></div>
            <div class="al-ru-opt"><span>Описания (Shiki)</span><input type="checkbox" id="al-ru-set-desc" ${settings.translateDescriptions ? 'checked' : ''}></div>
            <div class="al-ru-opt"><span>Персонажи (Shiki)</span><input type="checkbox" id="al-ru-set-chars" ${settings.translateCharacters ? 'checked' : ''}></div>
            <div class="al-ru-opt"><span>Персонал (Shiki)</span><input type="checkbox" id="al-ru-set-staff" ${settings.translateStaff ? 'checked' : ''}></div>
            <button class="al-ru-btn-clear" id="al-ru-clear-all">Сбросить кэш</button>
            <div style="font-size:9px;opacity:0.5;text-align:center;margin-top:10px;">Версия 1.3</div>
        `;
        document.body.appendChild(panel);
        document.getElementById('al-ru-set-titles').onchange = (e) => { GM_setValue('set_titles', e.target.checked); location.reload(); };
        document.getElementById('al-ru-set-desc').onchange = (e) => { GM_setValue('set_desc', e.target.checked); location.reload(); };
        document.getElementById('al-ru-set-chars').onchange = (e) => { GM_setValue('set_chars', e.target.checked); location.reload(); };
        document.getElementById('al-ru-set-staff').onchange = (e) => { GM_setValue('set_staff', e.target.checked); location.reload(); };
        document.getElementById('al-ru-clear-all').onclick = () => {
            GM_listValues().forEach(k => {
                if(k.startsWith('MED2_') || k.startsWith('CHR2_') || k.startsWith('STF3_') || k.startsWith('MEDIA_')) GM_deleteValue(k);
            });
            alert('Кэш очищен.'); location.reload();
        };
    }

    init();
})();
