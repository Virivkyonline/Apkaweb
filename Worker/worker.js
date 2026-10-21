import { connect } from "cloudflare:sockets";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response("", { headers: corsHeaders });
    }
        if (request.method === "OPTIONS") {
      return new Response("", { headers: corsHeaders });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Worker bezi.",
          endpoints: {
            admin: "/admin-stats?pin=780801",
            productDetail: "/product-detail?url=ENCODED_PRODUCT_URL",
            feed: "/feed?url=ENCODED_FEED_URL",
            appPing: "POST /app-ping",
            order: "POST /order"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }
    if (request.method === "GET" && url.pathname === "/feed") {
      return handleFeedProxy(url, corsHeaders);
    }

    if (request.method === "GET" && url.pathname === "/product-detail") {
      return handleProductDetail(url, corsHeaders);
    }

    if (request.method === "GET" && url.pathname === "/admin-stats") {
      return handleAdminStats(url, env, corsHeaders);
    }

    if (request.method === "POST" && url.pathname === "/app-ping") {
      return handleAppPing(request, env, corsHeaders);
    }

    if (request.method === "POST" && url.pathname === "/order") {
      return handleOrder(request, env, corsHeaders);
    }

    if (request.method === "POST") {
      return handleContactForm(request, env, corsHeaders);
    }

    return new Response(
      JSON.stringify({ success: false, error: "Pouzi GET alebo POST." }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      }
    );
  }
};

async function handleFeedProxy(url, corsHeaders) {
  try {
    const target = url.searchParams.get("url");

    if (!target) {
      return new Response("Missing url parameter", {
        status: 400,
        headers: corsHeaders
      });
    }

    const targetUrl = new URL(target);

    const feedResponse = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 PlatinumLechSpaApp/1.0",
        "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8"
      }
    });

    const text = await feedResponse.text();

    return new Response(text, {
      status: feedResponse.ok ? 200 : feedResponse.status,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        ...corsHeaders
      }
    });
  } catch (e) {
    return new Response("Feed proxy error", {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleProductDetail(url, corsHeaders) {
  try {
    const target = url.searchParams.get("url");

    if (!target) {
      return jsonResponse(
        { success: false, error: "Chyba: chyba url parameter." },
        400,
        corsHeaders
      );
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return jsonResponse(
        { success: false, error: "Neplatna URL adresa produktu." },
        400,
        corsHeaders
      );
    }

    if (!/virivkyonline\.sk$/i.test(targetUrl.hostname)) {
      return jsonResponse(
        { success: false, error: "Povolena je iba domena virivkyonline.sk." },
        400,
        corsHeaders
      );
    }

    const productResponse = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 PlatinumLechSpaApp/1.0",
        "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8"
      }
    });

    if (!productResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error: "Nepodarilo sa nacitat stranku produktu.",
          detail: "HTTP " + productResponse.status
        },
        productResponse.status,
        corsHeaders
      );
    }

    const html = await productResponse.text();
    const data = parseProductHtml(html, targetUrl.toString());

    return jsonResponse(
      {
        success: true,
        product: data
      },
      200,
      corsHeaders
    );
  } catch (e) {
    return jsonResponse(
      {
        success: false,
        error: "Chyba servera pri nacitani detailu produktu."
      },
      500,
      corsHeaders
    );
  }
}

async function handleAppPing(request, env, corsHeaders) {
  try {
    if (!env.APP_STATS) {
      return jsonResponse(
        { success: false, error: "Chyba: KV binding APP_STATS nie je nastavene." },
        500,
        corsHeaders
      );
    }

    const data = await request.json();
    const installId = String(data.installId || "").trim();

    if (!installId) {
      return jsonResponse(
        { success: false, error: "Chyba: chyba installId." },
        400,
        corsHeaders
      );
    }

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const key = "install:" + installId;

    const currentRaw = await env.APP_STATS.get(key);
    let record = null;

    try {
      record = currentRaw ? JSON.parse(currentRaw) : null;
    } catch {
      record = null;
    }

    const nextRecord = {
      installId,
      firstSeen: record?.firstSeen || now,
      lastSeen: now,
      firstSeenDate: record?.firstSeenDate || today,
      lastSeenDate: today,
      appName: String(data.appName || record?.appName || "").trim(),
      appVersion: String(data.appVersion || record?.appVersion || "").trim(),
      platform: String(data.platform || record?.platform || "").trim(),
      userAgent: String(data.userAgent || record?.userAgent || "").trim()
    };

    await env.APP_STATS.put(key, JSON.stringify(nextRecord));

    return jsonResponse(
      { success: true, message: "Ping ulozeny." },
      200,
      corsHeaders
    );
  } catch (e) {
    return jsonResponse(
      { success: false, error: "Chyba servera pri app-ping." },
      500,
      corsHeaders
    );
  }
}

async function handleAdminStats(url, env, corsHeaders) {
  try {
    const pin = String(url.searchParams.get("pin") || "").trim();
    const validPin = String(env.ADMIN_PIN || "780801").trim();

    if (!pin || pin !== validPin) {
      return jsonResponse(
        { success: false, error: "Neplatny PIN." },
        401,
        corsHeaders
      );
    }

    if (!env.APP_STATS) {
      return jsonResponse(
        { success: false, error: "Chyba: KV binding APP_STATS nie je nastavene." },
        500,
        corsHeaders
      );
    }

    const list = await env.APP_STATS.list({ prefix: "install:" });
    const now = Date.now();

    const DAY = 24 * 60 * 60 * 1000;

    let total = 0;
    let activeToday = 0;
    let active7d = 0;
    let active30d = 0;
    let active180d = 0;
    let active365d = 0;

    for (const keyInfo of list.keys) {
      const raw = await env.APP_STATS.get(keyInfo.name);
      if (!raw) continue;

      let record;
      try {
        record = JSON.parse(raw);
      } catch {
        continue;
      }

      total += 1;

      const lastSeen = Number(record?.lastSeen || 0);
      if (!lastSeen) continue;

      const diff = now - lastSeen;

      if (diff <= DAY) activeToday += 1;
      if (diff <= 7 * DAY) active7d += 1;
      if (diff <= 30 * DAY) active30d += 1;
      if (diff <= 180 * DAY) active180d += 1;
      if (diff <= 365 * DAY) active365d += 1;
    }

    return jsonResponse(
      {
        success: true,
        stats: {
          total,
          today: activeToday,
          days7: active7d,
          days30: active30d,
          days180: active180d,
          days365: active365d
        }
      },
      200,
      corsHeaders
    );
  } catch (e) {
    return jsonResponse(
      { success: false, error: "Chyba servera pri admin statistikach." },
      500,
      corsHeaders
    );
  }
}

function parseProductHtml(html, productUrl) {
  const cleanedHtml = removeScriptsAndStyles(html);

  const title =
    decodeHtmlEntities(
      firstMatch(cleanedHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      firstMatch(cleanedHtml, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"]+)["']/i) ||
      firstMatch(cleanedHtml, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
      "Produkt"
    ).trim();

  const metaDescription = decodeHtmlEntities(
    firstMatch(cleanedHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)["']/i) || ""
  ).trim();

  const gallery = extractGalleryImages(cleanedHtml, productUrl);
  const mainImage = gallery[0] || "";

  const price =
    decodeHtmlEntities(
      firstMatch(cleanedHtml, /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"]+)["']/i) || ""
    ).trim() ||
    findPriceInHtml(cleanedHtml);

  const description = extractFullDescription(cleanedHtml, metaDescription);
  const shortDescription = buildShortDescription(description, metaDescription);
  const variants = extractVariants(cleanedHtml);

  return {
    url: productUrl,
    title,
    price,
    image: mainImage,
    gallery,
    shortDescription,
    description,
    variants
  };
}

function removeScriptsAndStyles(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
}

function firstMatch(text, regex) {
  const m = text.match(regex);
  return m && m[1] ? m[1] : "";
}

function stripTags(text) {
  return decodeHtmlEntities(
    String(text || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function absolutizeUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return "";
  }
}

function extractGalleryImages(html, baseUrl) {
  const results = [];

  const galleryBlockRegexes = [
    /<div[^>]*class=["'][^"']*p-detail-inner[^"']*["'][\s\S]*?<\/div>\s*<\/div>/i,
    /<div[^>]*class=["'][^"']*p-image-wrapper[^"']*["'][\s\S]*?<\/div>/i,
    /<div[^>]*class=["'][^"']*p-thumbnails-wrapper[^"']*["'][\s\S]*?<\/div>/i,
    /<div[^>]*class=["'][^"']*p-image-thumbnails[^"']*["'][\s\S]*?<\/div>/i,
    /<div[^>]*class=["'][^"']*slick-track[^"']*["'][\s\S]*?<\/div>/i
  ];

  let galleryHtml = "";
  for (const regex of galleryBlockRegexes) {
    const m = html.match(regex);
    if (m && m[0]) {
      galleryHtml += " " + m[0];
    }
  }

  if (!galleryHtml) {
    const ogImage = firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"]+)["']/i);
    if (ogImage) {
      const full = absolutizeUrl(ogImage, baseUrl);
      return full ? [full] : [];
    }
    return [];
  }

  const imgRegex = /<(img|a)[^>]+(?:src|href|data-src|data-gallery-src)=["']([^"']+)["'][^>]*>/gi;
  let m;

  while ((m = imgRegex.exec(galleryHtml)) !== null) {
    const raw = m[2] || "";
    if (!raw) continue;

    const full = absolutizeUrl(raw, baseUrl);
    if (!full) continue;

    const lower = full.toLowerCase();

    if (
      !lower.includes("cdn.myshoptet.com") &&
      !lower.includes("myshoptet.com")
    ) continue;

    if (
      !lower.includes(".jpg") &&
      !lower.includes(".jpeg") &&
      !lower.includes(".png") &&
      !lower.includes(".webp")
    ) continue;

    if (
      lower.includes("favicon") ||
      lower.includes("logo") ||
      lower.includes("icon") ||
      lower.includes("placeholder") ||
      lower.includes("gift") ||
      lower.includes("house") ||
      lower.includes("home") ||
      lower.includes("badge") ||
      lower.includes("cert") ||
      lower.includes("filter") ||
      lower.includes("spa-line") ||
      lower.includes("chemia") ||
      lower.includes("tablety")
    ) continue;

    results.push(full);
  }

  const unique = [...new Set(results)];

  if (!unique.length) {
    const ogImage = firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"]+)["']/i);
    if (ogImage) {
      const full = absolutizeUrl(ogImage, baseUrl);
      return full ? [full] : [];
    }
  }

  return unique;
}

function findPriceInHtml(html) {
  const text = stripTags(html);
  const eurMatch = text.match(/(?:od\s*)?€\s*[0-9][0-9\s.,]*/i);
  if (eurMatch) {
    return eurMatch[0].replace(/\s+/g, " ").trim();
  }

  const eurAfterMatch = text.match(/(?:od\s*)?[0-9][0-9\s.,]*\s*€/i);
  if (eurAfterMatch) {
    return eurAfterMatch[0].replace(/\s+/g, " ").trim();
  }

  return "";
}

function extractFullDescription(html, fallback) {
  const candidates = [
    /<div[^>]*class=["'][^"']*description-inner[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*product-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*detail-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/section>/i
  ];

  for (const regex of candidates) {
    const found = firstMatch(html, regex);
    const stripped = cleanDescriptionText(stripTags(found));
    if (stripped && stripped.length > 80) {
      return stripped;
    }
  }

  return cleanDescriptionText(fallback || "");
}

function cleanDescriptionText(text) {
  return String(text || "")
    .replace(/^\s*Popis\s*/i, "")
    .replace(/\bZdieľať\b.*$/i, "")
    .replace(/\bTweet\b.*$/i, "")
    .replace(/\bKód:\b.*$/i, "")
    .replace(/\bStrážny pes\b.*$/i, "")
    .replace(/\bSúvisiaci tovar\b[\s\S]*$/i, "")
    .replace(/\bSuvisejici zbozi\b[\s\S]*$/i, "")
    .replace(/\bHodnotenie produktu\b[\s\S]*$/i, "")
    .replace(/\bDiskusia\b[\s\S]*$/i, "")
    .replace(/\bParametre\b[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildShortDescription(description, fallback) {
  const source = String(description || fallback || "").trim();
  if (!source) return "";

  const normalized = source.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) return normalized;

  return normalized.slice(0, 217).trim() + "...";
}

function extractVariants(html) {
  const text = stripTags(html);

  const oblozenie = extractVariantBlock(
    html,
    text,
    [
      "FARBA OBLOŽENIA A SCHODÍKOV",
      "FARBA OBLOZENIA A SCHODIKOV",
      "FARBA OBLOŽENIA",
      "FARBA OBLOZENIA",
      "OBLOŽENIE",
      "OBLOZENIE"
    ]
  );

  const akryl = extractVariantBlock(
    html,
    text,
    [
      "FARBA AKRYLU NA VÝBER",
      "FARBA AKRYLU NA VYBER",
      "FARBA AKRYLU",
      "AKRYL"
    ]
  );

  return {
    oblozenie,
    akryl
  };
}

function extractVariantBlock(html, plainText, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const selectRegex = new RegExp(
      escaped + "[\\s\\S]{0,250}?<select[\\s\\S]*?<\\/select>",
      "i"
    );
    const selectMatch = html.match(selectRegex);

    if (selectMatch) {
      const optionValues = extractOptionsFromSelect(selectMatch[0]);
      if (optionValues.length) return optionValues;
    }

    const textRegex = new RegExp(
      escaped + "\\s+Zvoľte variant\\s+([\\s\\S]*?)(?:\\n\\s*[A-ZÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ][^\\n]*Zvoľte variant|\\n\\s*Kód:|\\n\\s*Cena:|\\n\\s*€|$)",
      "i"
    );
    const textMatch = plainText.match(textRegex);

    if (textMatch && textMatch[1]) {
      const values = textMatch[1]
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .map(x => x.trim())
        .filter(Boolean)
        .filter(x => !/^zvoľte$/i.test(x))
        .filter(x => !/^zvolte$/i.test(x))
        .filter(x => !/^variant$/i.test(x))
        .filter(x => !/^reset$/i.test(x))
        .filter(x => !/^vybraných$/i.test(x))
        .filter(x => !/^parametrov\.?$/i.test(x));

      if (values.length) return [...new Set(values)];
    }
  }

  return [];
}

function extractOptionsFromSelect(selectHtml) {
  const options = [];
  const optionRegex = /<option[^>]*value=["']?([^"'>]*)["']?[^>]*>([\s\S]*?)<\/option>/gi;
  let m;

  while ((m = optionRegex.exec(selectHtml)) !== null) {
    const value = stripTags(m[1] || "").trim();
    const label = stripTags(m[2] || "").trim();
    const finalValue = label || value;

    if (!finalValue) continue;
    if (/zvoľte/i.test(finalValue)) continue;
    if (/zvolte/i.test(finalValue)) continue;
    if (/vyberte/i.test(finalValue)) continue;
    if (/reset/i.test(finalValue)) continue;

    options.push(finalValue);
  }

  return [...new Set(options)];
}

async function handleContactForm(request, env, corsHeaders) {
  try {
    const data = await request.json();

    const meno = (data.meno || "").trim();
    const email = (data.email || "").trim();
    const sprava = (data.sprava || "").trim();

    if (!meno || !email || !sprava) {
      return jsonResponse(
        { success: false, error: "Vypln vsetky polia." },
        400,
        corsHeaders
      );
    }

    if (!isValidEmail(email)) {
      return jsonResponse(
        { success: false, error: "Zadaj platny email." },
        400,
        corsHeaders
      );
    }

    const html =
      "<h2>Novy dopyt z formulara</h2>" +
      "<p><strong>Meno:</strong> " + escapeHtml(meno) + "</p>" +
      "<p><strong>Email:</strong> " + escapeHtml(email) + "</p>" +
      "<p><strong>Sprava:</strong></p>" +
      "<p>" + escapeHtml(sprava).replace(/\n/g, "<br>") + "</p>";

    const mailResponse = await sendEmail(env, {
      to: env.ORDER_EMAIL || "info@virivkyonline.sk",
      reply_to: email,
      subject: "Novy kontaktny formular od: " + meno,
      html
    });

    if (!mailResponse.ok) {
      const mailError = await mailResponse.text();
      return jsonResponse(
        {
          success: false,
          error: "Nepodarilo sa odoslat email.",
          detail: mailError
        },
        500,
        corsHeaders
      );
    }

    return jsonResponse(
      {
        success: true,
        message: "Formular bol uspesne odoslany."
      },
      200,
      corsHeaders
    );
  } catch (e) {
    return jsonResponse(
      {
        success: false,
        error: "Chyba servera."
      },
      500,
      corsHeaders
    );
  }
}

async function handleOrder(request, env, corsHeaders) {
  try {
    const data = await request.json();

    const meno = (data.meno || "").trim();
    const email = (data.email || "").trim();
    const phone = (data.phone || "").trim();
    const street = (data.street || "").trim();
    const houseNumber = (data.houseNumber || "").trim();
    const zip = (data.zip || "").trim();
    const city = (data.city || "").trim();
    const note = (data.note || "").trim();
    const items = Array.isArray(data.items) ? data.items : [];

    if (!meno || !email || !phone || !street || !houseNumber || !zip || !city || items.length === 0) {
      return jsonResponse(
        { success: false, error: "Vypln vsetky povinne udaje a pridaj produkty do kosika." },
        400,
        corsHeaders
      );
    }

    if (!isValidEmail(email)) {
      return jsonResponse(
        { success: false, error: "Zadaj platny email." },
        400,
        corsHeaders
      );
    }

    const phoneClean = phone.replace(/\s+/g, "");
    if (!/^09\d{8}$/.test(phoneClean)) {
      return jsonResponse(
        { success: false, error: "Telefonne cislo musi mat 10 cislic a zacinat na 09." },
        400,
        corsHeaders
      );
    }

    const zipClean = zip.replace(/\s+/g, "");
    if (!/^\d{5}$/.test(zipClean)) {
      return jsonResponse(
        { success: false, error: "PSC musi mat 5 cislic." },
        400,
        corsHeaders
      );
    }

    let total = 0;
    let itemsHtml = "";
    let itemsCustomerHtml = "";

    items.forEach((item, index) => {
      const title = (item.title || "Produkt").trim();
      const priceText = (item.price || "").trim();
      const qty = Math.max(1, parseInt(item.qty || 1, 10));
      const oblozenie = (item.oblozenie || "").trim();
      const akryl = (item.akryl || "").trim();

      const numericPrice = parsePriceNumber(priceText);
      const rowTotal = numericPrice * qty;
      total += rowTotal;

      const row =
        "<tr>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + (index + 1) + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + escapeHtml(title) + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + escapeHtml(priceText || "Cena na vyziadanie") + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + qty + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + escapeHtml(oblozenie || "-") + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + escapeHtml(akryl || "-") + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + (numericPrice ? rowTotal.toFixed(2) + " €" : "-") + "</td>" +
        "</tr>";

      itemsHtml += row;
      itemsCustomerHtml += row;
    });

    const addressHtml =
      escapeHtml(street) + " " + escapeHtml(houseNumber) + "<br>" +
      escapeHtml(zipClean) + " " + escapeHtml(city);

    const adminHtml =
      "<h2>Nova objednavka z aplikacie</h2>" +
      "<p><strong>Meno:</strong> " + escapeHtml(meno) + "</p>" +
      "<p><strong>Email:</strong> " + escapeHtml(email) + "</p>" +
      "<p><strong>Telefon:</strong> " + escapeHtml(phoneClean) + "</p>" +
      "<p><strong>Adresa dorucenia:</strong><br>" + addressHtml + "</p>" +
      "<p><strong>Poznamka:</strong><br>" + escapeHtml(note || "-").replace(/\n/g, "<br>") + "</p>" +
      "<h3>Produkty</h3>" +
      "<table style='border-collapse:collapse;width:100%;font-family:Arial,sans-serif;'>" +
        "<thead>" +
          "<tr>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>#</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Produkt</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Cena</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Pocet</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Farba oblozenia</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Farba akrylu</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Medzisucet</th>" +
          "</tr>" +
        "</thead>" +
        "<tbody>" + itemsHtml + "</tbody>" +
      "</table>" +
      "<p style='margin-top:16px;'><strong>Celkom:</strong> " + total.toFixed(2) + " €</p>";

    const customerHtml =
      "<h2>Potvrdenie objednavky</h2>" +
      "<p>Dakujeme za vasu objednavku. Kopia objednavky je nizsie.</p>" +
      "<p><strong>Meno:</strong> " + escapeHtml(meno) + "</p>" +
      "<p><strong>Telefon:</strong> " + escapeHtml(phoneClean) + "</p>" +
      "<p><strong>Adresa dorucenia:</strong><br>" + addressHtml + "</p>" +
      "<p><strong>Poznamka:</strong><br>" + escapeHtml(note || "-").replace(/\n/g, "<br>") + "</p>" +
      "<h3>Produkty</h3>" +
      "<table style='border-collapse:collapse;width:100%;font-family:Arial,sans-serif;'>" +
        "<thead>" +
          "<tr>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>#</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Produkt</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Cena</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Pocet</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Farba oblozenia</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Farba akrylu</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Medzisucet</th>" +
          "</tr>" +
        "</thead>" +
        "<tbody>" + itemsCustomerHtml + "</tbody>" +
      "</table>" +
      "<p style='margin-top:16px;'><strong>Celkom:</strong> " + total.toFixed(2) + " €</p>";

    const adminResponse = await sendEmail(env, {
      to: env.ORDER_EMAIL || "info@virivkyonline.sk",
      reply_to: email,
      subject: "Nova objednavka od: " + meno,
      html: adminHtml
    });

    if (!adminResponse.ok) {
      const mailError = await adminResponse.text();
      return jsonResponse(
        {
          success: false,
          error: "Nepodarilo sa odoslat objednavku.",
          detail: mailError
        },
        500,
        corsHeaders
      );
    }

    const customerResponse = await sendEmail(env, {
      to: email,
      subject: "Potvrdenie objednavky - Platinum Lech Spa",
      html: customerHtml
    });

    if (!customerResponse.ok) {
      const mailError = await customerResponse.text();
      return jsonResponse(
        {
          success: false,
          error: "Objednavka prisla nam, ale kopia zakaznikovi sa nepodarila odoslat.",
          detail: mailError
        },
        500,
        corsHeaders
      );
    }

    return jsonResponse(
      {
        success: true,
        message: "Objednavka bola uspesne odoslana."
      },
      200,
      corsHeaders
    );
  } catch (e) {
    return jsonResponse(
      {
        success: false,
        error: "Chyba servera pri objednavke."
      },
      500,
      corsHeaders
    );
  }
}

// Posiela email cez SMTP (napr. info@lech-web.sk). Nastavenia su v Cloudflare:
// SMTP_HOST, SMTP_PORT (465 alebo 587), SMTP_USER, SMTP_PASS, volitelne SMTP_FROM, SMTP_FROM_NAME.
// Vracia Response, aby volajuci mohli pouzit .ok a .text().
async function sendEmail(env, payload) {
  try {
    await sendSmtpMail(env, payload);
    return new Response("OK", { status: 200 });
  } catch (e) {
    return new Response("SMTP chyba: " + (e && e.message ? e.message : String(e)), { status: 502 });
  }
}

const SMTP_TIMEOUT_MS = 20000;

async function sendSmtpMail(env, payload) {
  const host = String(env.SMTP_HOST || "").trim();
  const port = parseInt(env.SMTP_PORT || "465", 10);
  const user = String(env.SMTP_USER || "").trim();
  const pass = String(env.SMTP_PASS || "");
  const fromAddress = String(env.SMTP_FROM || user).trim();
  const fromName = String(env.SMTP_FROM_NAME || "Platinum Lech Spa").trim();

  if (!host || !user || !pass) {
    throw new Error("SMTP nie je nastavene (chyba SMTP_HOST, SMTP_USER alebo SMTP_PASS).");
  }

  const recipients = (Array.isArray(payload.to) ? payload.to : [payload.to]).map(a => String(a || "").trim());
  const replyTo = payload.reply_to ? String(payload.reply_to).trim() : "";

  for (const address of [fromAddress, ...recipients, ...(replyTo ? [replyTo] : [])]) {
    if (!isValidEmail(address)) {
      throw new Error("Neplatna emailova adresa: " + address);
    }
  }

  const message = buildMimeMessage({
    fromName,
    fromAddress,
    recipients,
    replyTo,
    subject: payload.subject || "",
    html: payload.html || ""
  });

  const implicitTls = port === 465;
  let socket = connect({ hostname: host, port }, { secureTransport: implicitTls ? "on" : "starttls" });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("SMTP server neodpoveda.")), SMTP_TIMEOUT_MS);
  });

  const session = async () => {
    const ehloName = fromAddress.split("@")[1];
    let conn = smtpConnection(socket);

    await conn.command(null, [220], "Pripojenie");
    let ehlo = await conn.command("EHLO " + ehloName, [250], "EHLO");

    if (!implicitTls) {
      await conn.command("STARTTLS", [220], "STARTTLS");
      conn.release();
      socket = socket.startTls();
      conn = smtpConnection(socket);
      ehlo = await conn.command("EHLO " + ehloName, [250], "EHLO");
    }

    if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.text)) {
      await conn.command("AUTH PLAIN " + base64Utf8("\u0000" + user + "\u0000" + pass), [235], "Prihlasenie");
    } else {
      await conn.command("AUTH LOGIN", [334], "Prihlasenie");
      await conn.command(base64Utf8(user), [334], "Prihlasenie");
      await conn.command(base64Utf8(pass), [235], "Prihlasenie");
    }

    await conn.command("MAIL FROM:<" + fromAddress + ">", [250], "MAIL FROM");
    for (const address of recipients) {
      await conn.command("RCPT TO:<" + address + ">", [250, 251], "RCPT TO " + address);
    }
    await conn.command("DATA", [354], "DATA");
    await conn.command(message + "\r\n.", [250], "Odoslanie");

    try {
      await conn.command("QUIT", [221], "QUIT");
    } catch (e) {
      // Email uz bol prijaty, chyba pri QUIT nevadi.
    }
  };

  try {
    await Promise.race([session(), timeout]);
  } finally {
    clearTimeout(timer);
    try {
      socket.close();
    } catch (e) {
      // ignore
    }
  }
}

function smtpConnection(socket) {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  async function readReply() {
    const lines = [];
    while (true) {
      const end = buffer.indexOf("\n");
      if (end === -1) {
        const { value, done } = await reader.read();
        if (done) throw new Error("SMTP server ukoncil spojenie.");
        buffer += decoder.decode(value, { stream: true });
        continue;
      }
      const line = buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
      lines.push(line);
      if (!/^\d{3}-/.test(line)) {
        return { code: parseInt(line.slice(0, 3), 10), text: lines.join("\n") };
      }
    }
  }

  return {
    async command(line, expectedCodes, label) {
      if (line !== null) {
        await writer.write(encoder.encode(line + "\r\n"));
      }
      const reply = await readReply();
      if (!expectedCodes.includes(reply.code)) {
        throw new Error(label + ": " + reply.text);
      }
      return reply;
    },
    release() {
      reader.releaseLock();
      writer.releaseLock();
    }
  };
}

function buildMimeMessage({ fromName, fromAddress, recipients, replyTo, subject, html }) {
  const headers = [
    "From: " + encodeHeaderWord(fromName) + " <" + fromAddress + ">",
    "To: " + recipients.map(a => "<" + a + ">").join(", ")
  ];
  if (replyTo) {
    headers.push("Reply-To: <" + replyTo + ">");
  }
  headers.push(
    "Subject: " + encodeHeaderWord(subject),
    "Date: " + new Date().toUTCString(),
    "Message-ID: <" + crypto.randomUUID() + "@" + fromAddress.split("@")[1] + ">",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64"
  );

  const body = (base64Utf8(html).match(/.{1,76}/g) || []).join("\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

// RFC 2047: kazdy kusok max. 45 bajtov UTF-8, aby riadok hlavicky nebol prilis dlhy.
function encodeHeaderWord(text) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = "";
  for (const char of String(text).replace(/[\r\n]+/g, " ")) {
    if (current && encoder.encode(current + char).length > 45) {
      chunks.push(current);
      current = "";
    }
    current += char;
  }
  if (current || chunks.length === 0) {
    chunks.push(current);
  }
  return chunks.map(chunk => "=?UTF-8?B?" + base64Utf8(chunk) + "?=").join("\r\n ");
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function isValidEmail(email) {
  return email.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(email);
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}

function parsePriceNumber(priceText) {
  if (!priceText) return 0;
  const cleaned = String(priceText).replace(",", ".").replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
