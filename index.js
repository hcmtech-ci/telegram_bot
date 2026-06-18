const { Telegraf, Markup } = require('telegraf');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// ================= CONFIG & PORT SERVER =================
const app = express();
const PORT = process.env.PORT || 3000;

// Render Web Service အသက်ဝင်နေစေရန် Health Check Route
app.get('/', (req, res) => res.send('HCM VPN/VPS Management Bot is Live!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

if (!process.env.BOT_TOKEN || !process.env.SPREADSHEET_ID) {
  console.error("Error: BOT_TOKEN and SPREADSHEET_ID environment variables are required!");
  process.exit(1);
}

const ADMINS = ["6400493285"]; // ခွင့်ပြုထားသော Admin Chat ID

// Session States များကို သိမ်းဆည်းရန် ယာယီ Cache Memory
const userCache = {}; 
function getCache(chatId) { return userCache[chatId] || null; }
function putCache(chatId, state) { userCache[chatId] = state; }
function removeCache(chatId) { delete userCache[chatId]; }

// ================= GOOGLE SHEET CONNECTION =================
// Render ပေါ်တွင် စိတ်ချရစေရန် Credentials ကို Environment Variable (စာသား) အဖြစ် ဖတ်ပါမည်
let serviceAccountAuth;
try {
  const secrets = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  serviceAccountAuth = new JWT({
    email: secrets.client_email,
    key: secrets.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} catch (err) {
  console.error("CRITICAL ERROR: GOOGLE_SERVICE_ACCOUNT_JSON မမှန်ကန်ပါ သို့မဟုတ် မထည့်သွင်းရသေးပါ။", err);
}

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

async function initSheets() {
  try {
    await doc.loadInfo();
    console.log(`Connected to Google Sheet: ${doc.title}`);
  } catch (err) {
    console.error("Google Sheets Connection Failed:", err);
  }
}
initSheets();

const bot = new Telegraf(process.env.BOT_TOKEN);

// ================= KEYBOARD MENUS =================
const replyMenu = Markup.keyboard([
  ['« Back', '📊 Report', '❌ Cancel']
]).resize();

const inlineMainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('➕ New User', 'menu_new_user'), Markup.button.callback('🔄 Renew', 'menu_renew')],
  [Markup.button.callback('🔎 Find User', 'menu_find'), Markup.button.callback('🗑️ Delete User', 'menu_delete')],
  [Markup.button.callback('✏️ Edit Key', 'menu_edit_key')]
]);

// ================= COMMANDS & BASIC HANDLERS =================
bot.start((ctx) => {
  const chatId = ctx.chat.id.toString();
  if (!ADMINS.includes(chatId)) return ctx.reply("⛔ Access Denied");
  removeCache(chatId);
  ctx.reply("🎮 အောက်ခြေခလုတ်ဘားတန်း အသင့်ဖြစ်ပါပြီ။", replyMenu);
  return ctx.reply("📊 VPN/VPS Management Bot မှ ကြိုဆိုပါတယ်။\n\nအောက်ပါ Inline Menu ခလုတ်များကို အသုံးပြုနိုင်ပါပြီခင်ဗျာ။", inlineMainMenu);
});

bot.hears('❌ Cancel', (ctx) => {
  const chatId = ctx.chat.id.toString();
  removeCache(chatId);
  return ctx.reply("❌ လုပ်ဆောင်ချက်ကို ပယ်ဖျက်ပြီး ပင်မ Menu သို့ ပြန်ရောက်လာပါပြီ။", inlineMainMenu);
});

bot.hears('📊 Report', (ctx) => {
  const chatId = ctx.chat.id.toString();
  removeCache(chatId);
  const reportMenu = Markup.inlineKeyboard([
    [Markup.button.callback('📅 Today Report', 'rep_today')],
    [Markup.button.callback('📅 Monthly Report', 'rep_monthly')],
    [Markup.button.callback('📊 All Time Report', 'rep_all')],
    [Markup.button.callback('« Back to Main Menu', 'back_to_main')]
  ]);
  return ctx.reply("📊 ကြည့်ရှုလိုသော Report အမျိုးအစားကို ရွေးချယ်ပါ-", reportMenu);
});

bot.hears('« Back', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  await handleReplyBack(ctx, chatId);
});

// ================= TEXT MESSAGES STATE HANDLING =================
bot.on('text', async (ctx, next) => {
  const chatId = ctx.chat.id.toString();
  if (!ADMINS.includes(chatId)) return;
  
  const text = ctx.message.text.trim();
  if (['📊 Report', '❌ Cancel', '« Back', '/start'].includes(text)) return next();

  const state = getCache(chatId);
  if (!state) return;

  const parts = state.split("|");

  // NEW USER နာမည်စဝင်လာချိန်
  if (state === "ask_name_add") {
    putCache(chatId, `step_country|add|${text}`);
    return sendCountrySelection(ctx, text, "add");
  }

  // PRICE ဝင်လာချိန်
  if (parts[0] === "waiting_price") {
    if (!/^\d+$/.test(text)) return ctx.reply("❌ Number Only (ဂဏန်းသီးသန့်သာ ရိုက်ပါ)");
    const subType = parts[4]; // VPN, Outline, 3XUi
    
    if (subType === "3XUi") {
      putCache(chatId, `waiting_3x_url|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${text}`);
      return ctx.reply("🌐 3X-Ui Panel အတွက် Access URL Link ပို့ပေးပါဦး။");
    } else {
      const msgPrompt = (subType === "Outline") ? "🔑 API Key ပို့ပေးပါဦး။" : "🔑 VPN/VPS Key ပို့ပေးပါဦး။";
      putCache(chatId, `waiting_key|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${text}`);
      return ctx.reply(msgPrompt);
    }
  }

  // KEY ဝင်လာချိန်
  if (parts[0] === "waiting_key") {
    putCache(chatId, `waiting_link|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${text}`);
    return ctx.reply("🌐 Date ကြည့်ရန် Website Link ပို့ပေးပါဦးခင်ဗျာ-");
  }

  // WEBSITE LINK ဝင်လာချိန်
  if (parts[0] === "waiting_link") {
    putCache(chatId, `waiting_seller|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${parts[8]}|${text}`);
    return askSellerAdmin(ctx);
  }

  // ======= 3X-UI PANEL INPUTS FLOW =======
  if (parts[0] === "waiting_3x_url") {
    putCache(chatId, `waiting_3x_user|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${text}`);
    return ctx.reply("👤 3X-Ui Panel အတွက် Username ပို့ပေးပါဦး။");
  }
  if (parts[0] === "waiting_3x_user") {
    putCache(chatId, `waiting_3x_pass|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${parts[8]}|${text}`);
    return ctx.reply("🔒 3X-Ui Panel အတွက် Password ပို့ပေးပါဦး။");
  }
  if (parts[0] === "waiting_3x_pass") {
    const combined3XData = `3XURL:${parts[8]}||3XUSER:${parts[9]}||3XPASS:${text}`;
    putCache(chatId, `waiting_seller|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${combined3XData}|-`);
    return askSellerAdmin(ctx);
  }

  // EDIT KEY ဝင်လာချိန်
  if (parts[0] === "edit_key") {
    try {
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();
      const rowIndex = parseInt(parts[1]) - 2; 
      if (rows[rowIndex]) {
        rows[rowIndex].set('VPN KEY', Buffer.from(text).toString('base64'));
        await rows[rowIndex].save();
        removeCache(chatId);
        return ctx.reply("✅ Key Updated အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။");
      }
    } catch (e) {
      return ctx.reply("❌ ပြင်ဆင်ရာတွင် အမှားအယွင်းရှိသွားပါသည်။");
    }
  }
});

// ================= CALLBACK QUERIES HANDLING =================
bot.on('callback_query', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  if (!ADMINS.includes(chatId)) return ctx.answerCbQuery();

  const data = ctx.callbackQuery.data;
  
  if (data === "menu_new_user") {
    putCache(chatId, "ask_name_add");
    await ctx.reply("👤 New User အတွက် နာမည် ရိုက်ပို့ပေးပါဦးခင်ဗျာ-");
    return ctx.answerCbQuery();
  }
  if (data === "menu_renew") {
    await sendUserInlineList(ctx, "renew_list", "🔄 သက်တမ်းတိုးမည့် User ကို ရွေးချယ်ပါ-");
    return ctx.answerCbQuery();
  }
  if (data === "menu_find") {
    await sendUserInlineList(ctx, "find_info", "🔎 အချက်အလက်ကြည့်လိုသော User ကို ရွေးချယ်ပါ-");
    return ctx.answerCbQuery();
  }
  if (data === "menu_delete") {
    await sendUserInlineList(ctx, "del_conf", "🗑️ ဖြတ်ထုတ် (Delete) လိုသော User ကို ရွေးချယ်ပါ-");
    return ctx.answerCbQuery();
  }
  if (data === "menu_edit_key") {
    await sendEditList(ctx);
    return ctx.answerCbQuery();
  }
  if (data === "back_to_main") {
    removeCache(chatId);
    await ctx.editMessageText("📊 VPN/VPS Management Bot မှ ကြိုဆိုပါတယ်။\n\nအောက်ပါ Inline Menu ခလုတ်များကို အသုံးပြုနိုင်ပါပြီခင်ဗျာ။", inlineMainMenu);
    return ctx.answerCbQuery();
  }

  if (data === "rep_today") { await handleReport(ctx, 'today'); return ctx.answerCbQuery(); }
  if (data === "rep_monthly") { await handleReport(ctx, 'month'); return ctx.answerCbQuery(); }
  if (data === "rep_all") { await handleReport(ctx, 'all'); return ctx.answerCbQuery(); }

  if (data.startsWith("seller_select|")) {
    const sellerName = data.split("|")[1];
    const currentState = getCache(chatId);
    if (!currentState) return ctx.reply("❌ Session သက်တမ်းကုန်သွားပါပြီ။ /start မှ ပြန်စပါ။");
    
    const parts = currentState.split("|");
    if (parts[0] === "waiting_seller") {
      await saveOrRenewUser(ctx, chatId, parts[2], parts[3], parts[4], parts[5], parts[6], parts[1], parseInt(parts[7]), parts[8], parts[9], sellerName);
      removeCache(chatId);
    }
    return ctx.answerCbQuery();
  }

  if (data.startsWith("del_conf|")) {
    const rowNum = parseInt(data.split("|")[1]);
    await deleteUserByRow(ctx, rowNum);
    return ctx.answerCbQuery();
  }

  if (data.startsWith("find_info|")) {
    const rowNum = parseInt(data.split("|")[1]);
    await showUserInfoByRow(ctx, rowNum);
    return ctx.answerCbQuery();
  }

  if (data.startsWith("renew_list|")) {
    const name = data.split("|")[1];
    putCache(chatId, `step_country|renew|${name}`);
    await sendCountrySelection(ctx, name, "renew");
    return ctx.answerCbQuery();
  }

  // STEPS SUB-MENUS MULTI-FLOW NAVIGATION
  const parts = data.split("|");
  const step = parts[0];

  if (step === "nav_country") {
    if (parts[2] === "add") {
      putCache(chatId, "ask_name_add");
      await ctx.reply("👤 New User အတွက် နာမည်ကို စာသားပြန်ရိုက်ပေးပါ။");
    } else {
      await sendUserInlineList(ctx, "renew_list", "🔄 သက်တမ်းတိုးမည့် User ကို ရွေးချယ်ပါ-");
    }
  }
  else if (step === "country") {
    putCache(chatId, `step_service|${parts[3]}|${parts[1]}|${parts[2]}`);
    await sendServiceSelection(ctx, parts[1], parts[2], parts[3]);
  }
  else if (step === "nav_service") {
    putCache(chatId, `step_country|${parts[3]}|${parts[1]}`);
    await sendCountrySelection(ctx, parts[1], parts[3]);
  }
  else if (step === "service") {
    if (parts[3] === "VPN") {
      putCache(chatId, `step_spec|${parts[4]}|${parts[1]}|${parts[2]}|${parts[3]}`);
      await sendGBSelection(ctx, parts[1], parts[2], parts[4]);
    } else {
      await sendVpsSubTypeSelection(ctx, parts[1], parts[2], parts[4]);
    }
  }
  else if (step === "nav_spec") {
    if (parts[3] === "VPN") {
      putCache(chatId, `step_service|${parts[4]}|${parts[1]}|${parts[2]}`);
      await sendServiceSelection(ctx, parts[1], parts[2], parts[4]);
    } else {
      await sendVpsSubTypeSelection(ctx, parts[1], parts[2], parts[4]);
    }
  }
  else if (step === "vps_sub_choose") {
    putCache(chatId, `step_spec|${parts[4]}|${parts[1]}|${parts[2]}|${parts[3]}`);
    await sendTBSelection(ctx, parts[1], parts[2], parts[3], parts[4]);
  }
  else if (step === "gb" || step === "tb") {
    putCache(chatId, `step_month|${parts[5]}|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}`);
    await sendMonthSelection(ctx, parts[1], parts[2], parts[3], parts[4], parts[5]);
  }
  else if (step === "month") {
    putCache(chatId, `waiting_price|${parts[6]}|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}`);
    await ctx.editMessageText("💰 Price (ဈေးနှုန်း) ကို ဂဏန်းသီးသန့် ရိုက်ပို့ပေးပါ-");
  }
  else if (data.startsWith("edit_")) {
    const rowNum = parseInt(data.replace("edit_", ""));
    putCache(chatId, `edit_key|${rowNum}`);
    await ctx.editMessageText("🔑 New Key (ကီးအသစ်) ပို့ပေးပါ-");
  }

  return ctx.answerCbQuery();
});

// ================= REPLY REVERSE BACK LOGIC =================
async function handleReplyBack(ctx, chatId) {
  const currentState = getCache(chatId);
  if (!currentState) return ctx.reply("« ပြန်ဆုတ်ရန် ယခင်အဆင့် မရှိတော့ပါ။", inlineMainMenu);

  const parts = currentState.split("|");
  const stepName = parts[0];

  if (stepName === "ask_name_add") {
    removeCache(chatId);
    return ctx.reply("ပင်မ Menu သို့ ပြန်ရောက်ပါပြီ။", inlineMainMenu);
  }
  else if (stepName === "step_country") {
    if (parts[1] === "add") {
      putCache(chatId, "ask_name_add");
      return ctx.reply("👤 New User အတွက် နာမည် ပြန်လည်ရိုက်ပို့ပေးပါ-");
    } else {
      removeCache(chatId);
      return sendUserInlineList(ctx, "renew_list", "🔄 သက်တမ်းတိုးမည့် User ကို ပြန်လည်ရွေးချယ်ပါ-");
    }
  }
  else if (stepName === "step_service") {
    putCache(chatId, `step_country|${parts[1]}|${parts[2]}`);
    return sendCountrySelection(ctx, parts[2], parts[1]);
  }
  else if (stepName === "step_spec") {
    putCache(chatId, `step_service|${parts[1]}|${parts[2]}|${parts[3]}`);
    return sendServiceSelection(ctx, parts[2], parts[3], parts[1]);
  }
  else if (stepName === "step_month") {
    putCache(chatId, `step_spec|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}`);
    return parts[4] === "VPN" ? sendGBSelection(ctx, parts[2], parts[3], parts[1]) : sendTBSelection(ctx, parts[2], parts[3], parts[4], parts[1]);
  }
  else if (stepName === "waiting_price") {
    putCache(chatId, `step_month|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}`);
    return sendMonthSelection(ctx, parts[2], parts[3], parts[4], parts[5], parts[1]);
  }
  else if (stepName === "waiting_key") {
    putCache(chatId, `waiting_price|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}`);
    return ctx.reply("💰 Price (ဈေးနှုန်း) ကို ပြန်လည်ရိုက်ပို့ပေးပါ-");
  }
  else if (stepName === "waiting_link") {
    putCache(chatId, `waiting_key|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}`);
    return ctx.reply("🔑 VPN/VPS Key ကို ပြန်လည်ရိုက်ပို့ပေးပါ-");
  }
  else if (stepName === "waiting_seller") {
    if (parts[4] === "3XUi") {
      putCache(chatId, `waiting_3x_pass|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}`);
      return ctx.reply("🔒 3X-Ui Panel အတွက် Password ပြန်လည်ပို့ပေးပါဦး-");
    } else {
      putCache(chatId, `waiting_link|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${parts[8]}`);
      return ctx.reply("🌐 Date ကြည့်ရန် Website Link ကို ပြန်လည်ရိုက်ပို့ပေးပါ-");
    }
  }
  else if (stepName === "waiting_3x_url") {
    putCache(chatId, `waiting_price|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}`);
    return ctx.reply("💰 Price (ဈေးနှုန်း) ကို ပြန်လည်ရိုက်ပို့ပေးပါ-");
  }
  else if (stepName === "waiting_3x_user") {
    putCache(chatId, `waiting_3x_url|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}`);
    return ctx.reply("🌐 3X-Ui Panel အတွက် Access URL Link ပြန်လည်ပို့ပေးပါဦး-");
  }
  else if (stepName === "waiting_3x_pass") {
    putCache(chatId, `waiting_3x_user|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${parts[8]}`);
    return ctx.reply("👤 3X-Ui Panel အတွက် Username ပြန်လည်ပို့ပေးပါဦး-");
  }
  else {
    removeCache(chatId);
    return ctx.reply("ပင်မ Menu သို့ ပြန်ရောက်ပါပြီ။", inlineMainMenu);
  }
}

// ================= LAYOUT GENERATORS =================
function askSellerAdmin(ctx) {
  return ctx.reply("🧑‍💻 ဘယ် Admin က ရောင်းချတာလဲ ရွေးပေးပါဦး-", Markup.inlineKeyboard([
    [Markup.button.callback('👤 Owner-HCM', 'seller_select|Owner-HCM')],
    [Markup.button.callback('👤 Admin-CM', 'seller_select|Admin-CM')]
  ]));
}

async function sendCountrySelection(ctx, name, action) {
  const mk = Markup.inlineKeyboard([
    [Markup.button.callback('🇸🇬 Singapore', `country|${name}|SG|${action}`)],
    [Markup.button.callback('🇯🇵 Japan', `country|${name}|JP|${action}`)],
    [Markup.button.callback('🇺🇸 USA', `country|${name}|US|${action}`)],
    [Markup.button.callback('« Back', `nav_country|${name}|${action}`)]
  ]);
  const txt = `🌍 ${name} အတွက် နိုင်ငံ ရွေးချယ်ပေးပါ-`;
  if (ctx.callbackQuery) { await ctx.editMessageText(txt, mk); } else { await ctx.reply(txt, mk); }
}

function sendServiceSelection(ctx, name, country, action) {
  return ctx.editMessageText("🛠️ Service Type ရွေးချယ်ပါ-", Markup.inlineKeyboard([
    [Markup.button.callback('🌐 VPN', `service|${name}|${country}|VPN|${action}`)],
    [Markup.button.callback('🖥️ VPS', `service|${name}|${country}|VPS|${action}`)],
    [Markup.button.callback('« Back', `nav_service|${name}|${country}|${action}`)]
  ]));
}

function sendVpsSubTypeSelection(ctx, name, country, action) {
  return ctx.editMessageText("⚙️ VPS အမျိုးအစားကို ထပ်မံရွေးချယ်ပေးပါဦး-", Markup.inlineKeyboard([
    [Markup.button.callback('🌐 Outline Manager', `vps_sub_choose|${name}|${country}|Outline|${action}`)],
    [Markup.button.callback('🖥️ 3X-Ui Panel', `vps_sub_choose|${name}|${country}|3XUi|${action}`)],
    [Markup.button.callback('« Back', `nav_spec|${name}|${country}|VPS|${action}`)]
  ]));
}

async function sendGBSelection(ctx, name, country, action) {
  const mk = Markup.inlineKeyboard([
    [Markup.button.callback('📦 100 GB', `gb|${name}|${country}|VPN|100GB|${action}`), Markup.button.callback('📦 200 GB', `gb|${name}|${country}|VPN|200GB|${action}`)],
    [Markup.button.callback('📦 300 GB', `gb|${name}|${country}|VPN|300GB|${action}`), Markup.button.callback('📦 400 GB', `gb|${name}|${country}|VPN|400GB|${action}`)],
    [Markup.button.callback('📦 500 GB', `gb|${name}|${country}|VPN|500GB|${action}`), Markup.button.callback('📦 600 GB', `gb|${name}|${country}|VPN|600GB|${action}`)],
    [Markup.button.callback('📦 Unlimited Data', `gb|${name}|${country}|VPN|Unlimited Data|${action}`)],
    [Markup.button.callback('« Back', `nav_spec|${name}|${country}|VPN|${action}`)]
  ]);
  if (ctx.callbackQuery) { await ctx.editMessageText("📊 VPN Data Packages ရွေးချယ်ပါ-", mk); } else { await ctx.reply("📊 VPN Data Packages ရွေးချယ်ပါ-", mk); }
}

async function sendTBSelection(ctx, name, country, subType, action) {
  const mk = Markup.inlineKeyboard([
    [Markup.button.callback('🚀 1 TB', `tb|${name}|${country}|${subType}|1TB|${action}`), Markup.button.callback('🚀 2 TB', `tb|${name}|${country}|${subType}|2TB|${action}`)],
    [Markup.button.callback('🚀 3 TB', `tb|${name}|${country}|${subType}|3TB|${action}`), Markup.button.callback('🚀 4 TB', `tb|${name}|${country}|${subType}|4TB|${action}`)],
    [Markup.button.callback('🚀 5 TB', `tb|${name}|${country}|${subType}|5TB|${action}`)],
    [Markup.button.callback('« Back', `service|${name}|${country}|VPS|${action}`)]
  ]);
  const txt = `💾 ${subType} အတွက် Storage/Bandwidth ရွေးပါ-`;
  if (ctx.callbackQuery) { await ctx.editMessageText(txt, mk); } else { await ctx.reply(txt, mk); }
}

async function sendMonthSelection(ctx, name, country, service, spec, action) {
  const listButtons = [];
  if (service === "VPN" || service === "Outline") {
    listButtons.push([Markup.button.callback('1 လ', `month|${name}|${country}|${service}|${spec}|1|${action}`), Markup.button.callback('2 လ', `month|${name}|${country}|${service}|${spec}|2|${action}`), Markup.button.callback('3 လ', `month|${name}|${country}|${service}|${spec}|3|${action}`)]);
    listButtons.push([Markup.button.callback('4 လ', `month|${name}|${country}|${service}|${spec}|4|${action}`), Markup.button.callback('5 လ', `month|${name}|${country}|${service}|${spec}|5|${action}`), Markup.button.callback('6 လ', `month|${name}|${country}|${service}|${spec}|6|${action}`)]);
    listButtons.push([Markup.button.callback('7 လ', `month|${name}|${country}|${service}|${spec}|7|${action}`), Markup.button.callback('8 လ', `month|${name}|${country}|${service}|${spec}|8|${action}`), Markup.button.callback('9 လ', `month|${name}|${country}|${service}|${spec}|9|${action}`)]);
    listButtons.push([Markup.button.callback('Unlimited date', `month|${name}|${country}|${service}|${spec}|unlimited|${action}`)]);
  } else {
    listButtons.push([Markup.button.callback('1 လ', `month|${name}|${country}|${service}|${spec}|1|${action}`), Markup.button.callback('2 လ', `month|${name}|${country}|${service}|${spec}|2|${action}`), Markup.button.callback('3 လ', `month|${name}|${country}|${service}|${spec}|3|${action}`)]);
    listButtons.push([Markup.button.callback('4 လ', `month|${name}|${country}|${service}|${spec}|4|${action}`), Markup.button.callback('5 လ', `month|${name}|${country}|${service}|${spec}|5|${action}`)]);
  }
  listButtons.push([Markup.button.callback('« Back', `nav_spec|${name}|${country}|${service}|${action}`)]);

  if (ctx.callbackQuery) { await ctx.editMessageText("📅 သက်တမ်းကာလ (Duration) ရွေးချယ်ပါ-", Markup.inlineKeyboard(listButtons)); } else { await ctx.reply("📅 သက်တမ်းကာလ (Duration) ရွေးချယ်ပါ-", Markup.inlineKeyboard(listButtons)); }
}

// ================= GOOGLE SHEETS CORE METHODS =================
async function sendUserInlineList(ctx, prefix, titleText) {
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  const buttons = [];
  let rowButtons = [];

  rows.forEach((row, index) => {
    const name = row.get('NAME');
    if (name) {
      const callbackVal = prefix === "renew_list" ? `${prefix}|${name}` : `${prefix}|${index + 2}`;
      rowButtons.push(Markup.button.callback(`👤 ${name}`, callbackVal));
      if (rowButtons.length === 3) {
        buttons.push(rowButtons);
        rowButtons = [];
      }
    }
  });
  if (rowButtons.length > 0) buttons.push(rowButtons);
  buttons.push([Markup.button.callback('« Back to Main Menu', 'back_to_main')]);

  if (ctx.callbackQuery) { await ctx.editMessageText(titleText, Markup.inlineKeyboard(buttons)); } else { await ctx.reply(titleText, Markup.inlineKeyboard(buttons)); }
}

async function sendEditList(ctx) {
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  const buttons = [];
  let rowButtons = [];

  rows.forEach((row, index) => {
    const name = row.get('NAME');
    if (name) {
      rowButtons.push(Markup.button.callback(`👤 ${name}`, `edit_${index + 2}`));
      if (rowButtons.length === 3) {
        buttons.push(rowButtons);
        rowButtons = [];
      }
    }
  });
  if (rowButtons.length > 0) buttons.push(rowButtons);
  buttons.push([Markup.button.callback('« Back to Main Menu', 'back_to_main')]);

  if (buttons.length === 1) return ctx.reply("❌ ပြင်ဆင်ရန် User မရှိသေးပါ။");
  await ctx.editMessageText("🔑 Key ပြင်ဆင်လိုသော User ကို ရွေးချယ်ပါ-", Markup.inlineKeyboard(buttons));
}

async function showUserInfoByRow(ctx, rowNum) {
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  const row = rows[rowNum - 2];

  if (!row) return ctx.editMessageText("❌ User ရှာမတွေ့ပါ။");

  const name = row.get('NAME');
  const type = row.get('VPN TYPE');
  const exp = row.get('EXPER-DATE') || 'Unlimited';
  const money = row.get('MONEY') || 0;
  const renew = row.get('RENEW') || 0;
  const webLink = row.get('WEB LINK') || '-';
  const seller = row.get('SELLER') || '-';
  const base64Key = row.get('VPN KEY') || '';

  let rawKey = base64Key ? Buffer.from(base64Key, 'base64').toString('utf-8') : '-';
  let keyDisplay = `<code>${rawKey}</code>`;
  
  if (type.includes("3X-Ui")) {
    try {
      const p = rawKey.split("||");
      keyDisplay = `\n🔗 URL: <code>${p[0].replace("3XURL:", "")}</code>\n👤 User: <code>${p[1].replace("3XUSER:", "")}</code>\n🔒 Pass: <code>${p[2].replace("3XPASS:", "")}</code>`;
    } catch(e) {}
  }

  const info = `🔎 <b>USER DETAILS</b>\n━━━━━━━━━━━━━━━━━━\n👤 นာမည်: ${name}\n📦 အမျိုးအစား: ${type}\n💰 ဈေးနှုန်း: ${money} MMK\n🔄 Renew: ${renew}\n⏳ Expiry: ${exp}\n🔗 Link: <code>${webLink}</code>\n🧑‍💻 Admin: ${seller}\n\n🔑 Key/Panel: ${keyDisplay}\n━━━━━━━━━━━━━━━━━━`;
  await ctx.editMessageText(info, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Back to List', 'menu_find')]]) });
}

async function deleteUserByRow(ctx, rowNum) {
  try {
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    await rows[rowNum - 2].delete();
    await ctx.editMessageText("✅ User ကို စာရင်းထဲမှ အလိုအလျောက် ဖြတ်တောက်ပြီးပါပြီ။", Markup.inlineKeyboard([[Markup.button.callback('« Back to List', 'menu_delete')]]));
  } catch (e) {
    await ctx.reply("❌ ဖြတ်တောက်ရာတွင် Error တက်သွားပါသည်။");
  }
}

async function saveOrRenewUser(ctx, chatId, name, country, service, spec, month, action, price, key, webLink, sellerAdmin) {
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Yangon' });

  let displayPack = `${spec} (${month === "unlimited" ? "Unlimited" : month + "လ"})`;
  if (service === "Outline") displayPack = `Outline ${displayPack}`;
  if (service === "3XUi") displayPack = `3X-Ui ${displayPack}`;

  const encodedKey = Buffer.from(key).toString('base64');

  if (action === "add") {
    let finalName = name;
    let count = 0;
    rows.forEach(r => {
      const rName = r.get('NAME') || '';
      if (rName.toLowerCase().startsWith(name.toLowerCase())) count++;
    });
    if (count > 0) finalName = `${name} (${count < 10 ? '0' + count : count})`;

    let expiryStr = "Unlimited";
    if (month !== "unlimited") {
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + parseInt(month));
      expiryStr = expDate.toLocaleDateString('en-US', { timeZone: 'Asia/Yangon' });
    }

    await sheet.addRow({
      'Date': todayStr, 'NAME': finalName, 'VPN TYPE': displayPack, 'EXPER-DATE': expiryStr, 'MONEY': price, 'RENEW': 0, 'VPN KEY': encodedKey, 'WEB LINK': webLink, 'SELLER': sellerAdmin
    });
    await ctx.reply("✅ စာရင်းသွင်းခြင်း အောင်မြင်ပါသည်။");
    await sendSuccessMsg(ctx, service, finalName, displayPack, price, todayStr, expiryStr, key, webLink, sellerAdmin);
  } 
  else if (action === "renew") {
    let targetRow = null;
    rows.forEach(r => {
      if (r.get('NAME')?.toLowerCase() === name.toLowerCase()) targetRow = r;
    });

    if (!targetRow) return ctx.reply("❌ User ရှာမတွေ့တော့ပါ။");

    const curRenew = parseInt(targetRow.get('RENEW')) || 0;
    const oldExp = targetRow.get('EXPER-DATE') || 'Unlimited';

    let baseDate = new Date();
    if (oldExp !== "Unlimited") {
      const parsed = new Date(oldExp);
      if (!isNaN(parsed.getTime()) && parsed > baseDate) baseDate = parsed;
    }

    let expiryStr = "Unlimited";
    if (month !== "unlimited") {
      baseDate.setMonth(baseDate.getMonth() + parseInt(month));
      expiryStr = baseDate.toLocaleDateString('en-US', { timeZone: 'Asia/Yangon' });
    }

    targetRow.set('Date', todayStr);
    targetRow.set('VPN TYPE', displayPack);
    targetRow.set('EXPER-DATE', expiryStr);
    targetRow.set('MONEY', price);
    targetRow.set('RENEW', curRenew + 1);
    targetRow.set('VPN KEY', encodedKey);
    targetRow.set('WEB LINK', webLink);
    targetRow.set('SELLER', sellerAdmin);
    await targetRow.save();

    await ctx.reply("🔄 သက်တမ်းတိုးခြင်း အောင်မြင်ပါသည်။");
    await sendSuccessMsg(ctx, service, name, displayPack, price, todayStr, expiryStr, key, webLink, sellerAdmin);
  }
}

function sendSuccessMsg(ctx, service, name, displayPack, price, todayStr, expiryStr, key, webLink, sellerAdmin) {
  let msg = "";
  if (service === "3XUi") {
    let url = "-", user = "-", pass = "-";
    try {
      const p = key.split("||");
      url = p[0].replace("3XURL:", ""); user = p[1].replace("3XUSER:", ""); pass = p[2].replace("3XPASS:", "");
    } catch(e) {}
    msg = `🖥️ <b>3X-UI PANEL DETAILS</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 ဝယ်သူ (User): ${name}\n📦 ပက်ကေ့ဂျ် (Package): ${displayPack}\n💰 ကျသင့်ငွေ (Price): ${price} MMK\n📅 စတင်ရက် (Start): ${todayStr}\n⌛️ သက်တမ်းကုန်ရက် (Expiry): ${expiryStr}\n🧑‍💻 ရောင်းချသူ Admin: ${sellerAdmin}\n━━━━━━━━━━━━━━━━━━━━\n🌐 Access URL: <code>${url}</code>\n👤 User: <code>${user}</code>\n🔒 Pass: <code>${pass}</code>\n━━━━━━━━━━━━━━━━━━━━`;
  } else {
    msg = `🌐 <b>VPN / VPS SUMMARY DETAILS</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 ဝယ်သူ (User): ${name}\n📦 ပက်ကေ့ဂျ် (Package): ${displayPack}\n💰 ကျသင့်ငွေ (Price): ${price} MMK\n📅 စတင်ရက် (Start): ${todayStr}\n⌛️ သက်တမ်းကုန်ရက် (Expiry): ${expiryStr}\n🧑‍💻 ရောင်းချသူ Admin: ${sellerAdmin}\n━━━━━━━━━━━━━━━━━━━━\n🔑 Key:\n<code>${key}</code>\n\n🔗 Link:\n<code>${webLink}</code>\n━━━━━━━━━━━━━━━━━━━━`;
  }
  return ctx.replyWithHTML(msg, inlineMainMenu);
}

// ================= REPORT HANDLER LOGIC =================
async function handleReport(ctx, filterType) {
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Yangon' });
  
  // လက်ရှိလနှင့်နှစ်ကို Format ခွဲထုတ်ခြင်း (ဥပမာ "6", "2026")
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  let count = 0, income = 0;
  let adminSales = { "Owner-HCM": 0, "Admin-CM": 0 };
  let vpnCount = 0, vpsCount = 0;
  let allListText = "";

  rows.forEach(row => {
    const rDate = row.get('Date') || '';
    const rName = row.get('NAME') || '';
    const rType = row.get('VPN TYPE') || '';
    const rMoney = parseInt(row.get('MONEY')) || 0;
    const rSeller = row.get('SELLER') || 'Owner-HCM';
    const rExp = row.get('EXPER-DATE') || 'Unlimited';
    const rRenew = row.get('RENEW') || 0;

    let isMatch = false;
    if (filterType === 'today' && rDate === todayStr) isMatch = true;
    if (filterType === 'month' && rDate.includes('/')) {
      const p = rDate.split('/'); // "M/D/YYYY" format ဖြစ်လေ့ရှိသည်
      if (parseInt(p[0]) === currentMonth && parseInt(p[2]) === currentYear) isMatch = true;
    }
    if (filterType === 'all') isMatch = true;

    if (isMatch) {
      count++;
      income += rMoney;
      if (adminSales[rSeller] !== undefined) adminSales[rSeller] += rMoney;
      if (rType.includes("Outline") || rType.includes("3X-Ui")) vpsCount++; else vpnCount++;
      
      if (filterType === 'all') {
        allListText += `👤 ${rName}\n📦 ${rType}\n💰 ${rMoney} MMK | 🔄 ${rRenew} | ⏳ ${rExp}\n-------------------------\n`;
      }
    }
  });

  let title = filterType === 'today' ? `📅 TODAY REPORT (${todayStr})` : filterType === 'month' ? `📅 MONTHLY REPORT (${currentYear}-${currentMonth})` : `📊 ALL TIME REPORT`;
  
  let msg = `<b>${title}</b>\n━━━━━━━━━━━━━━━━━━\n`;
  if (filterType === 'all') msg += `${allListText}\n`;
  msg += `✨ စုစုပေါင်းဦးရေ: ${count} ယောက်\n💰 စုစုပေါင်းဝင်ငွေ: ${income} MMK\n\n🧑‍💻 <b>ADMIN SALES SUMMARY</b>\n├── Owner-HCM: ${adminSales["Owner-HCM"]} MMK\n└── Admin-CM: ${adminSales["Admin-CM"]} MMK\n\n📦 <b>SERVICE SUMMARY</b>\n├── 🌐 VPN Keys: ${vpnCount} ခု\n└── 🖥️ VPS (Outline/3X): ${vpsCount} လုံး`;

  await ctx.replyWithHTML(msg, inlineMainMenu);
}

// Bot ကို စတင်မောင်းနှင်ခြင်း
bot.launch().then(() => console.log("Telegram Bot started successfully!"));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
