// Full browser headers for WebPOS page requests
const WEBPOS_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "Upgrade-Insecure-Requests": "1",
};

// Minimal base headers — callers add Accept/Sec-Fetch-* per request
const DEFAULT_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
};

const CP2_WEBPOS_BASE = "https://nus-utown.evs.com.sg";
const EVS_API_BASE = "https://p-1.evs.com.sg";
const ENETS_PP_HOST = "https://enetspp-nus-live.evs.com.sg";
const NETS_API_HOST = "https://api.nets.com.sg";
module.exports = {
  WEBPOS_HEADERS,
  DEFAULT_HEADERS,
  CP2_WEBPOS_BASE,
  EVS_API_BASE,
  ENETS_PP_HOST,
  NETS_API_HOST,
};
