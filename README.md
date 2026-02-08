# 🚀 Web Scraping API

A powerful yet simple web scraping API built with Node.js, Express, Axios, and Cheerio.

## 📋 What This API Does

This API allows you to scrape data from any website and get it back in JSON format. Perfect for:
- Extracting headlines from news sites
- Monitoring prices on e-commerce sites
- Collecting images from web pages
- Gathering links and content
- Building custom scrapers with your own CSS selectors

## 🛠️ Technologies Used

- **Node.js** - JavaScript runtime
- **Express.js** - Web framework for building APIs
- **Axios** - HTTP client for fetching web pages
- **Cheerio** - jQuery-like HTML parser for scraping
- **CORS** - Enable cross-origin requests

## 📦 Installation

### Step 1: Install Dependencies

```bash
npm install
```

This will install:
- express
- axios
- cheerio
- cors
- nodemon (for development)

### Step 2: Start the Server

```bash
npm start
```

Or for development with auto-restart:

```bash
npm run dev
```

The API will be running at: **http://localhost:3000**

## 🎯 API Endpoints

### 1. **GET /** - API Documentation
Get information about all available endpoints.

**Example:**
```
http://localhost:3000/
```

---

### 2. **GET /api/scrape** - Basic Web Scraper
Scrapes title, description, headings, and paragraphs from any URL.

**Parameters:**
- `url` (required) - The URL to scrape

**Example:**
```
http://localhost:3000/api/scrape?url=https://example.com
```

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://example.com",
    "title": "Example Domain",
    "description": "Example website description",
    "headings": {
      "h1": ["Main Heading"],
      "h2": ["Subheading 1", "Subheading 2"]
    },
    "paragraphs": ["First paragraph...", "Second paragraph..."],
    "linkCount": 15,
    "imageCount": 8,
    "scrapedAt": "2026-01-19T16:07:00.000Z"
  }
}
```

---

### 3. **GET /api/scrape/headlines** - Extract Headlines
Extracts all H1, H2, and H3 headlines from a page.

**Example:**
```
http://localhost:3000/api/scrape/headlines?url=https://news.ycombinator.com
```

**Response:**
```json
{
  "success": true,
  "url": "https://news.ycombinator.com",
  "headlines": {
    "h1": ["Hacker News"],
    "h2": ["Top Stories", "New Stories"],
    "h3": ["Story 1", "Story 2", "Story 3"]
  },
  "totalHeadlines": 6
}
```

---

### 4. **GET /api/scrape/prices** - Extract Prices
Finds and extracts prices from e-commerce pages.

**Example:**
```
http://localhost:3000/api/scrape/prices?url=https://amazon.com/product-page
```

**Response:**
```json
{
  "success": true,
  "url": "https://amazon.com/product-page",
  "pricesFound": 3,
  "prices": [
    {
      "text": "Price: $99.99",
      "price": "$99.99",
      "selector": ".price"
    }
  ]
}
```

---

### 5. **GET /api/scrape/images** - Extract Images
Gets all images from a page with their attributes.

**Example:**
```
http://localhost:3000/api/scrape/images?url=https://example.com
```

**Response:**
```json
{
  "success": true,
  "url": "https://example.com",
  "totalImages": 12,
  "images": [
    {
      "src": "https://example.com/image1.jpg",
      "alt": "Image description",
      "width": "800",
      "height": "600"
    }
  ]
}
```

---

### 6. **GET /api/scrape/links** - Extract Links
Gets all links from a page.

**Example:**
```
http://localhost:3000/api/scrape/links?url=https://example.com
```

**Response:**
```json
{
  "success": true,
  "url": "https://example.com",
  "totalLinks": 25,
  "links": [
    {
      "text": "Click here",
      "href": "https://example.com/page",
      "title": "Link title"
    }
  ]
}
```

---

### 7. **POST /api/scrape/custom** - Custom Scraper
Use your own CSS selectors to scrape specific data.

**Request Body:**
```json
{
  "url": "https://example.com",
  "selectors": {
    "title": "h1.main-title",
    "price": ".product-price",
    "description": ".product-desc"
  }
}
```

**Example using cURL:**
```bash
curl -X POST http://localhost:3000/api/scrape/custom \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "selectors": {
      "title": "h1",
      "price": ".price"
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "url": "https://example.com",
  "data": {
    "title": ["Product Title"],
    "price": ["$99.99"]
  }
}
```

## 🧪 Testing the API

### Using Your Browser
Simply open:
```
http://localhost:3000/api/scrape?url=https://example.com
```

### Using JavaScript (Fetch)
```javascript
fetch('http://localhost:3000/api/scrape?url=https://example.com')
  .then(response => response.json())
  .then(data => console.log(data));
```

### Using Postman or Thunder Client
1. Create a new GET request
2. URL: `http://localhost:3000/api/scrape`
3. Add query parameter: `url` = `https://example.com`
4. Send!

## 📁 Project Structure

```
Web_Scraping_API/
├── server.js          # Main API server
├── package.json       # Dependencies and scripts
├── README.md          # This file
└── .gitignore         # Git ignore file
```

## ⚠️ Important Notes

### Legal Considerations
- Always check a website's `robots.txt` file
- Respect the website's Terms of Service
- Don't overload servers with too many requests
- Some websites prohibit scraping

### Rate Limiting
- Built-in API rate limiting is enabled (configurable via env vars)
- Add client-side delays between requests to avoid site-side blocking
- Optional proxy support is available for large-scale scraping

### Error Handling
The API includes error handling for:
- Invalid URLs
- Network errors
- Parsing errors
- Missing parameters

## 🚀 Current Feature Status

### Implemented Enhancements:
1. ✅ **Rate Limiting** - Prevent abuse
2. ✅ **Caching** - Store scraped data temporarily
3. ✅ **Authentication** - API key support
4. ✅ **Database** - Persist scraped results
5. ✅ **Scheduling** - Cron-based scraper jobs
6. ✅ **Proxy Support** - Optional per-request proxy
7. ✅ **Frontend Dashboard** - Stats and job management at `/dashboard.html`
8. ✅ **Container Deployment** - `Dockerfile` and `docker-compose.yml`

### Suggested Next Improvements:
1. Add specialized scrapers for specific websites
2. Add retry/backoff policies for unstable targets
3. Add robots.txt-aware scraping policies

## 📚 Learn More

- [Express.js Documentation](https://expressjs.com/)
- [Cheerio Documentation](https://cheerio.js.org/)
- [Axios Documentation](https://axios-http.com/)
- [Web Scraping Best Practices](https://www.scrapehero.com/web-scraping-best-practices/)

## 🤝 Contributing

Feel free to add more scraping endpoints or improve existing ones!

## 📄 License

MIT License - Feel free to use this for learning and personal projects.

---

**Built with ❤️ using Node.js**
