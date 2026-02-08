// ============================================
// WEB SCRAPING API - SERVER
// ============================================

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_SECONDS || 300) * 1000;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 100);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'scrape-results.json');
const API_KEYS = (process.env.API_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

const cache = new Map();
const scheduledJobs = new Map();

const DEFAULT_HEADERS = {
    'User-Agent':
        process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

let dbWriteQueue = Promise.resolve();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
    rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        max: RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
    })
);

app.use('/api', (req, res, next) => {
    if (API_KEYS.length === 0) {
        return next();
    }

    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const provided = req.headers['x-api-key'] || bearer;

    if (!provided || !API_KEYS.includes(provided)) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized. Provide a valid API key using x-api-key header.',
        });
    }

    return next();
});

function isValidHttpUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function normalizeUrl(url) {
    return url.trim();
}

function parseProxyValue(rawProxy) {
    if (!rawProxy) {
        return null;
    }

    try {
        const parsed = new URL(rawProxy);
        return {
            protocol: parsed.protocol.replace(':', ''),
            host: parsed.hostname,
            port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
            auth:
                parsed.username || parsed.password
                    ? {
                          username: decodeURIComponent(parsed.username),
                          password: decodeURIComponent(parsed.password),
                      }
                    : undefined,
        };
    } catch {
        return null;
    }
}

function hashKey(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function buildCacheKey(type, payload) {
    return hashKey(`${type}:${JSON.stringify(payload)}`);
}

function readCache(key) {
    const entry = cache.get(key);
    if (!entry) {
        return null;
    }

    if (entry.expiresAt < Date.now()) {
        cache.delete(key);
        return null;
    }

    return entry.value;
}

function writeCache(key, value) {
    cache.set(key, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
}

async function ensureDbFile() {
    const dbDir = path.dirname(DB_FILE);
    await fs.mkdir(dbDir, { recursive: true });

    try {
        await fs.access(DB_FILE);
    } catch {
        const initial = { records: [], schedules: [] };
        await fs.writeFile(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    }
}

async function readDb() {
    await ensureDbFile();
    const raw = await fs.readFile(DB_FILE, 'utf8');

    try {
        const parsed = JSON.parse(raw || '{}');
        return {
            records: Array.isArray(parsed.records) ? parsed.records : [],
            schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
        };
    } catch {
        return { records: [], schedules: [] };
    }
}

async function writeDb(nextDb) {
    dbWriteQueue = dbWriteQueue.then(() =>
        fs.writeFile(DB_FILE, JSON.stringify(nextDb, null, 2), 'utf8')
    );
    await dbWriteQueue;
}

async function appendRecord(record) {
    const db = await readDb();
    db.records.unshift(record);

    // Keep storage bounded.
    const maxRecords = Number(process.env.MAX_STORED_RECORDS || 2000);
    if (db.records.length > maxRecords) {
        db.records = db.records.slice(0, maxRecords);
    }

    await writeDb(db);
}

async function saveSchedules(schedules) {
    const db = await readDb();
    db.schedules = schedules;
    await writeDb(db);
}

async function getSchedules() {
    const db = await readDb();
    return db.schedules;
}

async function getAxiosResponse(url, proxy) {
    const proxyConfig = parseProxyValue(proxy);

    return axios.get(url, {
        headers: DEFAULT_HEADERS,
        timeout: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
        proxy: proxyConfig || undefined,
        maxRedirects: 5,
    });
}

function toAbsoluteUrl(baseUrl, maybeRelative) {
    if (!maybeRelative) {
        return maybeRelative;
    }

    try {
        return new URL(maybeRelative, baseUrl).toString();
    } catch {
        return maybeRelative;
    }
}

function extractBasicData($, url) {
    return {
        url,
        title: $('title').first().text().trim() || 'No title found',
        description:
            $('meta[name="description"]').attr('content') || 'No description found',
        headings: {
            h1: $('h1')
                .map((_, el) => $(el).text().trim())
                .get(),
            h2: $('h2')
                .map((_, el) => $(el).text().trim())
                .get(),
        },
        paragraphs: $('p')
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean)
            .slice(0, 5),
        linkCount: $('a').length,
        imageCount: $('img').length,
        scrapedAt: new Date().toISOString(),
    };
}

function extractHeadlines($) {
    const headlines = {
        h1: $('h1')
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean),
        h2: $('h2')
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean),
        h3: $('h3')
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean),
    };

    return {
        headlines,
        totalHeadlines: headlines.h1.length + headlines.h2.length + headlines.h3.length,
    };
}

function extractPrices($) {
    const priceSelectors = [
        '.price',
        '.product-price',
        '[class*="price"]',
        '[id*="price"]',
        'span[class*="Price"]',
    ];

    const seen = new Set();
    const prices = [];

    for (const selector of priceSelectors) {
        $(selector).each((_, el) => {
            const text = $(el).text().trim();
            if (!text) {
                return;
            }

            const matches = text.match(/[$А?ге]\s*[\d,]+\.?\d*/g);
            if (!matches) {
                return;
            }

            for (const match of matches) {
                const signature = `${selector}:${match}:${text}`;
                if (seen.has(signature)) {
                    continue;
                }
                seen.add(signature);
                prices.push({ text, price: match, selector });
            }
        });
    }

    return {
        pricesFound: prices.length,
        prices,
    };
}

function extractImages($, url) {
    const images = $('img')
        .map((_, el) => ({
            src: toAbsoluteUrl(url, $(el).attr('src')),
            alt: $(el).attr('alt') || 'No alt text',
            width: $(el).attr('width') || null,
            height: $(el).attr('height') || null,
        }))
        .get()
        .filter((img) => Boolean(img.src));

    return {
        totalImages: images.length,
        images,
    };
}

function extractLinks($, url) {
    const links = $('a')
        .map((_, el) => ({
            text: $(el).text().trim(),
            href: toAbsoluteUrl(url, $(el).attr('href')),
            title: $(el).attr('title') || '',
        }))
        .get()
        .filter((link) => Boolean(link.href));

    return {
        totalLinks: links.length,
        links,
    };
}

function extractCustomSelectors($, selectors) {
    const results = {};

    for (const [key, selector] of Object.entries(selectors || {})) {
        if (typeof selector !== 'string' || selector.trim() === '') {
            continue;
        }

        results[key] = $(selector)
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
    }

    return results;
}

async function runScrape({ type, url, selectors, proxy }) {
    if (!url || !isValidHttpUrl(url)) {
        throw new Error('A valid http/https URL is required');
    }

    const normalizedUrl = normalizeUrl(url);
    const cacheKey = buildCacheKey(type, {
        url: normalizedUrl,
        selectors: selectors || null,
        proxy: proxy || null,
    });

    const cached = readCache(cacheKey);
    if (cached) {
        return { ...cached, cached: true };
    }

    const response = await getAxiosResponse(normalizedUrl, proxy);
    const $ = cheerio.load(response.data);

    let payload;
    switch (type) {
        case 'basic':
            payload = extractBasicData($, normalizedUrl);
            break;
        case 'headlines':
            payload = { url: normalizedUrl, ...extractHeadlines($) };
            break;
        case 'prices':
            payload = { url: normalizedUrl, ...extractPrices($) };
            break;
        case 'images':
            payload = { url: normalizedUrl, ...extractImages($, normalizedUrl) };
            break;
        case 'links':
            payload = { url: normalizedUrl, ...extractLinks($, normalizedUrl) };
            break;
        case 'custom':
            payload = {
                url: normalizedUrl,
                data: extractCustomSelectors($, selectors),
            };
            break;
        default:
            throw new Error(`Unsupported scrape type: ${type}`);
    }

    const result = {
        success: true,
        type,
        data: payload,
        cached: false,
    };

    writeCache(cacheKey, result);

    await appendRecord({
        id: crypto.randomUUID(),
        type,
        url: normalizedUrl,
        selectors: selectors || null,
        status: 'success',
        createdAt: new Date().toISOString(),
        responseSummary: {
            keys: Object.keys(payload),
        },
    });

    return result;
}

async function runScheduledScrape(schedule) {
    try {
        await runScrape({
            type: schedule.type,
            url: schedule.url,
            selectors: schedule.selectors || null,
            proxy: schedule.proxy || null,
        });

        const allSchedules = await getSchedules();
        const updated = allSchedules.map((item) => {
            if (item.id !== schedule.id) {
                return item;
            }

            return {
                ...item,
                lastRunAt: new Date().toISOString(),
                lastStatus: 'success',
                lastError: null,
            };
        });
        await saveSchedules(updated);
    } catch (error) {
        const allSchedules = await getSchedules();
        const updated = allSchedules.map((item) => {
            if (item.id !== schedule.id) {
                return item;
            }

            return {
                ...item,
                lastRunAt: new Date().toISOString(),
                lastStatus: 'error',
                lastError: error.message,
            };
        });

        await saveSchedules(updated);

        await appendRecord({
            id: crypto.randomUUID(),
            type: schedule.type,
            url: schedule.url,
            selectors: schedule.selectors || null,
            status: 'error',
            error: error.message,
            createdAt: new Date().toISOString(),
            responseSummary: null,
        });
    }
}

function registerSchedule(schedule) {
    if (!cron.validate(schedule.cron)) {
        throw new Error('Invalid cron expression');
    }

    const task = cron.schedule(schedule.cron, () => {
        void runScheduledScrape(schedule);
    });

    scheduledJobs.set(schedule.id, task);
}

function unregisterSchedule(scheduleId) {
    const task = scheduledJobs.get(scheduleId);
    if (task) {
        task.stop();
        scheduledJobs.delete(scheduleId);
    }
}

async function restoreSchedules() {
    const schedules = await getSchedules();

    for (const schedule of schedules) {
        try {
            registerSchedule(schedule);
        } catch (error) {
            console.error(`Skipping invalid schedule ${schedule.id}: ${error.message}`);
        }
    }
}

function parseRequestParams(req) {
    const url = req.query.url || req.body.url;
    const proxy = req.query.proxy || req.body.proxy;
    return { url, proxy };
}

async function handleScrapeRequest(res, scrapeInput) {
    try {
        const result = await runScrape(scrapeInput);
        return res.json(result);
    } catch (error) {
        return res.status(400).json({
            success: false,
            error: error.message,
        });
    }
}

app.get('/', (req, res) => {
    res.json({
        message: 'Welcome to Web Scraping API',
        version: '2.0.0',
        dashboard: '/dashboard.html',
        authEnabled: API_KEYS.length > 0,
        endpoints: {
            '/api/scrape?url=': 'Basic page scrape',
            '/api/scrape/headlines?url=': 'Extract headlines',
            '/api/scrape/prices?url=': 'Extract price-like text',
            '/api/scrape/images?url=': 'Extract image URLs',
            '/api/scrape/links?url=': 'Extract links',
            'POST /api/scrape/custom': 'Custom selector scrape',
            '/api/records': 'Persisted scraping history',
            '/api/schedules': 'Cron-based scheduled scraping jobs',
            '/api/stats': 'Dashboard metrics',
        },
    });
});

app.get('/api/scrape', async (req, res) => {
    const { url, proxy } = parseRequestParams(req);
    await handleScrapeRequest(res, { type: 'basic', url, proxy });
});

app.get('/api/scrape/headlines', async (req, res) => {
    const { url, proxy } = parseRequestParams(req);
    await handleScrapeRequest(res, { type: 'headlines', url, proxy });
});

app.get('/api/scrape/prices', async (req, res) => {
    const { url, proxy } = parseRequestParams(req);
    await handleScrapeRequest(res, { type: 'prices', url, proxy });
});

app.get('/api/scrape/images', async (req, res) => {
    const { url, proxy } = parseRequestParams(req);
    await handleScrapeRequest(res, { type: 'images', url, proxy });
});

app.get('/api/scrape/links', async (req, res) => {
    const { url, proxy } = parseRequestParams(req);
    await handleScrapeRequest(res, { type: 'links', url, proxy });
});

app.post('/api/scrape/custom', async (req, res) => {
    const { url, proxy } = parseRequestParams(req);
    const selectors = req.body.selectors;

    if (!selectors || typeof selectors !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'selectors object is required',
        });
    }

    await handleScrapeRequest(res, {
        type: 'custom',
        url,
        selectors,
        proxy,
    });
});

app.get('/api/records', async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 500);
    const db = await readDb();
    return res.json({
        success: true,
        total: db.records.length,
        records: db.records.slice(0, limit),
    });
});

app.get('/api/stats', async (req, res) => {
    const db = await readDb();
    const byType = db.records.reduce((acc, record) => {
        acc[record.type] = (acc[record.type] || 0) + 1;
        return acc;
    }, {});

    const successful = db.records.filter((r) => r.status === 'success').length;
    const failed = db.records.filter((r) => r.status === 'error').length;

    return res.json({
        success: true,
        stats: {
            totalRecords: db.records.length,
            successful,
            failed,
            activeSchedules: db.schedules.length,
            cacheEntries: cache.size,
            byType,
            latestRecordAt: db.records[0]?.createdAt || null,
        },
    });
});

app.get('/api/schedules', async (req, res) => {
    const schedules = await getSchedules();
    return res.json({ success: true, schedules });
});

app.post('/api/schedules', async (req, res) => {
    const { name, type, url, cron: cronExpression, selectors, proxy } = req.body;

    if (!name || !type || !url || !cronExpression) {
        return res.status(400).json({
            success: false,
            error: 'name, type, url, and cron are required',
        });
    }

    if (!['basic', 'headlines', 'prices', 'images', 'links', 'custom'].includes(type)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid schedule type',
        });
    }

    if (!cron.validate(cronExpression)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid cron expression',
        });
    }

    const schedules = await getSchedules();

    const schedule = {
        id: crypto.randomUUID(),
        name,
        type,
        url,
        selectors: selectors || null,
        proxy: proxy || null,
        cron: cronExpression,
        createdAt: new Date().toISOString(),
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
    };

    schedules.push(schedule);
    await saveSchedules(schedules);

    registerSchedule(schedule);

    return res.status(201).json({ success: true, schedule });
});

app.delete('/api/schedules/:id', async (req, res) => {
    const scheduleId = req.params.id;
    const schedules = await getSchedules();

    const next = schedules.filter((item) => item.id !== scheduleId);
    if (next.length === schedules.length) {
        return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    unregisterSchedule(scheduleId);
    await saveSchedules(next);

    return res.json({ success: true });
});

app.post('/api/schedules/:id/run', async (req, res) => {
    const schedules = await getSchedules();
    const schedule = schedules.find((item) => item.id === req.params.id);

    if (!schedule) {
        return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    try {
        const result = await runScrape({
            type: schedule.type,
            url: schedule.url,
            selectors: schedule.selectors || null,
            proxy: schedule.proxy || null,
        });

        return res.json({ success: true, result });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
});

async function bootstrap() {
    await ensureDbFile();
    await restoreSchedules();

    app.listen(PORT, () => {
        console.log(`Web Scraping API running at http://localhost:${PORT}`);
        console.log(`Dashboard: http://localhost:${PORT}/dashboard.html`);
        if (API_KEYS.length > 0) {
            console.log('API key auth enabled for /api endpoints');
        }
    });
}

bootstrap().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
