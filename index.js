const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

// Config Environments
const TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMINS = ["6400493285"]; 

const bot = new Telegraf(TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Memory Cache for States
const userCache = new Map();

// Helpers
function escapeHtml(text) {
  if (!text) return "";
  return text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getTodayStr() {
  return new Date().toLocaleString("en-US", {timeZone: "Asia/Yangon"}).split(',')[0].replace(/\//g, '-');
}

function formatCustomDate(date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[date.getDay()]} ${date.getMonth() + 1}.${date.getDate()}.${date.getFullYear()}`;
}

// Check Admin Middleware
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id.toString();
  if (chatId && !ADMINS.includes(chatId)) {
    return ctx.reply("⛔ Access Denied");
  }
  return next();
});

// ================= COMMANDS =================
bot.start((ctx) => {
  const chatId = ctx.chat.id.toString();
  userCache.delete(chatId);
  sendMainMenu(ctx, "📊 VPN/VPS Management Bot မှ ကြိုဆိုပါတယ်။\n\nအောက်ပါ Inline Menu ခလုတ်များကို အသုံးပြုနိုင်ပါပြီခင်ဗျာ။");
});

bot.hears("❌ Cancel", (ctx) => {
  const chatId = ctx.chat.id.toString();
  userCache.delete(chatId);
  sendMainMenu(ctx, "❌ လုပ်ဆောင်ချက်ကို ပယ်ဖျက်ပြီး ပင်မ Menu သို့ ပြန်ရောက်လာပါပြီ။");
});

bot.hears("📊 Report", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  userCache.delete(chatId);
  
  ctx.reply("📊 ကြည့်ရှုလိုသော Report အမျိုးအစားကို ရွေးချယ်ပါ-", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📅 Today Report", callback_data: "rep_today" }],
        [{ text: "📅 Monthly Report", callback_data: "rep_monthly" }],
        [{ text: "📊 All Time Report", callback_data: "rep_all" }],
        [{ text: "« Back to Main Menu", callback_data: "back_to_main" }]
      ]
    }
  });
});

bot.hears("« Back", (ctx) => {
  handleReplyBack(ctx);
});

// ================= CALLBACKS =================
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat.id.toString();
  const messageId = ctx.callbackQuery.message.message_id;

  if (data === "menu_new_user") {
    userCache.set(chatId, "ask_name_add");
    return ctx.reply("👤 New User အတွက် နာမည် ရိုက်ပို့ပေးပါဦးခင်ဗျာ-");
  }

  if (data === "menu_renew") {
    return sendUserInlineList(ctx, "renew_list", "🔄 သက်တမ်းတိုးမည့် User ကို ရွေးချယ်ပါ-", messageId);
  }

  if (data === "menu_find") {
    return sendUserInlineList(ctx, "find_info", "🔎 အချက်အလက်ကြည့်လိုသော User ကို ရွေးချယ်ပါ-", messageId);
  }

  if (data === "menu_delete") {
    return sendUserInlineList(ctx, "del_conf", "🗑️ ဖြတ်ထုတ် (Delete) လိုသော User ကို ရွေးချယ်ပါ-", messageId);
  }

  if (data === "menu_edit_key") {
    return sendEditList(ctx, messageId);
  }

  if (data === "back_to_main") {
    userCache.delete(chatId);
    return ctx.telegram.editMessageText(chatId, messageId, null, "📊 VPN/VPS Management Bot မှ ကြိုဆိုပါတယ်။", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ New User", callback_data: "menu_new_user" }, { text: "🔄 Renew", callback_data: "menu_renew" }],
          [{ text: "🔎 Find User", callback_data: "menu_find" }, { text: "🗑️ Delete User", callback_data: "menu_delete" }],
          [{ text: "✏️ Edit Key", callback_data: "menu_edit_key" }]
        ]
      }
    });
  }

  // Reports
  if (data === "rep_today") return handleTodayReport(ctx);
  if (data === "rep_monthly") return handleMonthlyReport(ctx);
  if (data === "rep_all") return handleFullReport(ctx);

  // Seller Selection
  if (data.startsWith("seller_select|")) {
    const sellerName = data.split("|")[1];
    const currentState = userCache.get(chatId);
    if (!currentState) return ctx.reply("❌ Session သက်တမ်းကုန်သွားပါပြီ။ /start မှ ပြန်စပါ။");

    const parts = currentState.split("|");
    if (parts[0] === "waiting_seller") {
      await saveOrRenewUser(ctx, parts[2], parts[3], parts[4], parts[5], parts[6], parts[1], parseInt(parts[7]), parts[8], parts[9], sellerName);
      userCache.delete(chatId);
      return ctx.telegram.editMessageText(chatId, messageId, null, "✅ စာရင်းသွင်းခြင်း လုပ်ငန်းစဉ် အောင်မြင်စွာ ပြီးဆုံးပါပြီ။");
    }
  }

  if (data.startsWith("del_conf|")) {
    const id = data.split("|")[1];
    await supabase.from('users_vps').delete().eq('id', id);
    return ctx.telegram.editMessageText(chatId, messageId, null, "✅ User ကို စာရင်းထဲမှ အလိုအလျောက် ဖြတ်တောက်ပြီးပါပြီ။", {
      reply_markup: { inline_keyboard: [[{ text: "« Back to List", callback_data: "menu_delete" }]] }
    });
  }

  if (data.startsWith("find_info|")) {
    const id = data.split("|")[1];
    return showUserInfo(ctx, messageId, id);
  }

  if (data.startsWith("renew_list|")) {
    const name = data.split("|")[1];
    userCache.set(chatId, "step_country|renew|" + name);
    return sendCountrySelection(ctx, messageId, name, "renew");
  }

  // Steps handling Wizard
  const parts = data.split("|");
  const step = parts[0];

  if (step === "nav_country") {
    const [_, name, action] = parts;
    if (action === "add") {
      userCache.set(chatId, "ask_name_add");
      return ctx.telegram.editMessageText(chatId, messageId, null, "👤 New User အတွက် နာမည်ကို စာသားရိုက်ရမည့် အဆင့်ဖြစ်၍ အောက်ခြေ '« Back' ခလုတ်ကို သုံးပေးပါ။");
    } else {
      return sendUserInlineList(ctx, "renew_list", "🔄 သက်တမ်းတိုးမည့် User ကို ရွေးချယ်ပါ-", messageId);
    }
  }
  else if (step === "country") {
    userCache.set(chatId, "step_service|" + parts[3] + "|" + parts[1] + "|" + parts[2]);
    return sendServiceSelection(ctx, messageId, parts[1], parts[2], parts[3]);
  }
  else if (step === "service") {
    const [_, name, country, serviceType, action] = parts;
    if (serviceType === "VPN") {
      userCache.set(chatId, "step_spec|" + action + "|" + name + "|" + country + "|" + serviceType);
      return sendGBSelection(ctx, messageId, name, country, action);
    } else {
      return sendVpsSubTypeSelection(ctx, messageId, name, country, action);
    }
  }
  else if (step === "vps_sub_choose") {
    const [_, name, country, subType, action] = parts;
    userCache.set(chatId, "step_spec|" + action + "|" + name + "|" + country + "|" + subType);
    return sendTBSelection(ctx, messageId, name, country, subType, action);
  }
  else if (step === "gb" || step === "tb") {
    userCache.set(chatId, "step_month|" + parts[5] + "|" + parts[1] + "|" + parts[2] + "|" + parts[3] + "|" + parts[4]);
    return sendMonthSelection(ctx, messageId, parts[1], parts[2], parts[3], parts[4], parts[5]);
  }
  else if (step === "month") {
    userCache.set(chatId, "waiting_price|" + parts[6] + "|" + parts[1] + "|" + parts[2] + "|" + parts[3] + "|" + parts[4] + "|" + parts[5]);
    return ctx.telegram.editMessageText(chatId, messageId, null, "💰 Price (ဈေးနှုန်း) ကို ဂဏန်းသီးသန့် ရိုက်ပို့ပေးပါ-");
  }
  else if (data.startsWith("edit_")) {
    const id = data.replace("edit_", "");
    userCache.set(chatId, "edit_key|" + id);
    return ctx.telegram.editMessageText(chatId, messageId, null, "🔑 New Key (ကီးအသစ်) ပို့ပေးပါ- \n(ပြန်ဆုတ်လိုပါက အောက်ခြေ '« Back' စာသားခလုတ်ကို သုံးပါ)");
  }
});

// ================= TEXT MESSAGES INPUTS HANDLING =================
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const text = ctx.message.text.trim();
  const state = userCache.get(chatId);
  if (!state) return;

  const parts = state.split("|");

  if (state === "ask_name_add") {
    const safeName = escapeHtml(text);
    userCache.set(chatId, "step_country|add|" + safeName);
    return sendCountrySelection(ctx, null, safeName, "add");
  }

  if (parts[0] === "waiting_price") {
    if (!/^\d+$/.test(text)) return ctx.reply("❌ Number Only (ဂဏန်းသီးသန့်သာ ရိုက်ပါ)");
    const subType = parts[4];
    
    if (subType === "3XUi") {
      userCache.set(chatId, `waiting_3x_url|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${text}`);
      return ctx.reply("🌐 3X-Ui Panel အတွက် Access URL Link ပို့ပေးပါဦး။");
    } else {
      const msgPrompt = (subType === "Outline") ? "🔑 API Key ပို့ပေးပါဦး।" : "🔑 VPN/VPS Key ပို့ပေးပါဦး।";
      userCache.set(chatId, `waiting_key|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${text}`);
      return ctx.reply(msgPrompt);
    }
  }

  if (parts[0] === "waiting_key") {
    userCache.set(chatId, `waiting_link|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${text}`);
    return ctx.reply("🌐 Date ကြည့်ရန် Website Link ပို့ပေးပါဦးခင်ဗျာ-");
  }

  if (parts[0] === "waiting_link") {
    userCache.set(chatId, `waiting_seller|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${parts[8]}|${text}`);
    return askSellerAdmin(ctx);
  }

  // 3X-UI Flows
  if (parts[0] === "waiting_3x_url") {
    userCache.set(chatId, `waiting_3x_user|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${text}`);
    return ctx.reply("👤 3X-Ui Panel အတွက် Username ပို့ပေးပါဦး။");
  }
  if (parts[0] === "waiting_3x_user") {
    userCache.set(chatId, `waiting_3x_pass|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${parts[8]}|${text}`);
    return ctx.reply("🔒 3X-Ui Panel အတွက် Password ပို့ပေးပါဦး။");
  }
  if (parts[0] === "waiting_3x_pass") {
    const combined3XData = `3XURL:${parts[8]}||3XUSER:${parts[9]}||3XPASS:${text}`;
    userCache.set(chatId, `waiting_seller|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${combined3XData}|-`);
    return askSellerAdmin(ctx);
  }

  if (parts[0] === "edit_key") {
    const id = parts[1];
    const encodedKey = Buffer.from(text).toString('base64');
    await supabase.from('users_vps').update({ key_data: encodedKey }).eq('id', id);
    userCache.delete(chatId);
    return ctx.reply("✅ Key Updated အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။");
  }
});

// ================= WIZARD BACK BUTTON LOGIC =================
function handleReplyBack(ctx) {
  const chatId = ctx.chat.id.toString();
  const currentState = userCache.get(chatId);
  if (!currentState) return sendMainMenu(ctx, "« ပြန်ဆုတ်ရန် ယခင်အဆင့် မရှိတော့ပါ။");

  const parts = currentState.split("|");
  const stepName = parts[0];

  if (stepName === "ask_name_add") {
    userCache.delete(chatId);
    sendMainMenu(ctx);
  } 
  else if (stepName === "step_country") {
    if (parts[1] === "add") {
      userCache.set(chatId, "ask_name_add");
      ctx.reply("👤 New User အတွက် နာမည် ပြန်လည်ရိုက်ပို့ပေးပါ-");
    } else {
      userCache.delete(chatId);
      sendUserInlineList(ctx, "renew_list", "🔄 သက်တမ်းတိုးမည့် User ကို ပြန်လည်ရွေးချယ်ပါ-");
    }
  } 
  else if (stepName === "step_service") {
    userCache.set(chatId, `step_country|${parts[1]}|${parts[2]}`);
    sendCountrySelection(ctx, null, parts[2], parts[1]);
  } 
  else if (stepName === "step_spec") {
    userCache.set(chatId, `step_service|${parts[1]}|${parts[2]}|${parts[3]}`);
    sendServiceSelection(ctx, null, parts[2], parts[3], parts[1]);
  } 
  else if (stepName === "step_month") {
    userCache.set(chatId, `step_spec|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}`);
    if (parts[4] === "VPN") {
      sendGBSelection(ctx, null, parts[2], parts[3], parts[1]);
    } else {
      sendTBSelection(ctx, null, parts[2], parts[3], parts[4], parts[1]);
    }
  } 
  else if (stepName === "waiting_price") {
    userCache.set(chatId, `step_month|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}`);
    sendMonthSelection(ctx, null, parts[2], parts[3], parts[4], parts[5], parts[1]);
  } 
  else if (stepName === "waiting_key") {
    userCache.set(chatId, `waiting_price|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}`);
    ctx.reply("💰 Price (ဈေးနှုန်း) ကို ပြန်လည်ရိုက်ပို့ပေးပါ-");
  } 
  else if (stepName === "waiting_link") {
    userCache.set(chatId, `waiting_key|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}`);
    ctx.reply("🔑 VPN/VPS Key ကို ပြန်လည်ရိုက်ပို့ပေးပါ-");
  }
  else if (stepName === "waiting_seller") {
    if (parts[4] === "3XUi") {
      userCache.set(chatId, `waiting_3x_pass|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}`);
      ctx.reply("🔒 3X-Ui Panel အတွက် Password ပြန်လည်ပို့ပေးပါဦး-");
    } else {
      userCache.set(chatId, `waiting_link|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${parts[8]}`);
      ctx.reply("🌐 Date ကြည့်ရန် Website Link ကို ပြန်လည်ရိုက်ပို့ပေးပါ-");
    }
  }
  else if (stepName === "waiting_3x_url") {
    userCache.set(chatId, `waiting_price|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}`);
    ctx.reply("💰 Price (ဈေးနှုန်း) ကို ပြန်လည်ရိုက်ပို့ပေးပါ-");
  }
  else if (stepName === "waiting_3x_user") {
    userCache.set(chatId, `waiting_3x_url|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}`);
    ctx.reply("🌐 3X-Ui Panel အတွက် Access URL Link ပြန်လည်ပို့ပေးပါဦး-");
  }
  else if (stepName === "waiting_3x_pass") {
    userCache.set(chatId, `waiting_3x_user|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5]}|${parts[6]}|${parts[7]}|${parts[8]}`);
    ctx.reply("👤 3X-Ui Panel အတွက် Username ပြန်လည်ပို့ပေးပါဦး-");
  }
}

// ================= INTERFACES SENDERS =================
function sendMainMenu(ctx, txt) {
  ctx.reply("🎮 အောက်ခြေခလုတ်ဘားတန်း အသင့်ဖြစ်ပါပြီ။", {
    reply_markup: { keyboard: [[{ text: "« Back" }, { text: "📊 Report" }, { text: "❌ Cancel" }]], resize_keyboard: true }
  });
  ctx.reply(txt || "📊 VPN/VPS Management Bot", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ New User", callback_data: "menu_new_user" }, { text: "🔄 Renew", callback_data: "menu_renew" }],
        [{ text: "🔎 Find User", callback_data: "menu_find" }, { text: "🗑️ Delete User", callback_data: "menu_delete" }],
        [{ text: "✏️ Edit Key", callback_data: "menu_edit_key" }]
      ]
    }
  });
}

async function sendUserInlineList(ctx, prefix, title, msgId) {
  const { data: users } = await supabase.from('users_vps').select('id, name');
  let buttons = [];
  let row = [];
  
  if (users) {
    users.forEach(u => {
      const cb = prefix === "renew_list" ? `${prefix}|${u.name}` : `${prefix}|${u.id}`;
      row.push({ text: "👤 " + u.name, callback_data: cb });
      if (row.length === 3) { buttons.push(row); row = []; }
    });
  }
  if (row.length > 0) buttons.push(row);
  buttons.push([{ text: "« Back to Main Menu", callback_data: "back_to_main" }]);

  if (msgId) ctx.telegram.editMessageText(ctx.chat.id, msgId, null, title, { reply_markup: { inline_keyboard: buttons } });
  else ctx.reply(title, { reply_markup: { inline_keyboard: buttons } });
}

async function sendEditList(ctx, msgId) {
  return sendUserInlineList(ctx, "edit", "🔑 Key ပြင်ဆင်လိုသော User ကို ရွေးချယ်ပါ-", msgId);
}

function sendCountrySelection(ctx, msgId, name, action) {
  const markup = {
    inline_keyboard: [
      [{ text: "🇸🇬 Singapore", callback_data: `country|${name}|SG|${action}` }],
      [{ text: "🇯🇵 Japan", callback_data: `country|${name}|JP|${action}` }],
      [{ text: "🇺🇸 USA", callback_data: `country|${name}|US|${action}` }],
      [{ text: "« Back", callback_data: `nav_country|${name}|${action}` }]
    ]
  };
  if (msgId) ctx.telegram.editMessageText(ctx.chat.id, msgId, null, `🌍 ${name} အတွက် နိုင်ငံ ရွေးချယ်ပေးပါ-`, { reply_markup: markup });
  else ctx.reply(`🌍 ${name} အတွက် နိုင်ငံ ရွေးချယ်ပေးပါ-`, { reply_markup: markup });
}

function sendServiceSelection(ctx, msgId, name, country, action) {
  const markup = {
    inline_keyboard: [
      [{ text: "🌐 VPN", callback_data: `service|${name}|${country}|VPN|${action}` }],
      [{ text: "🖥️ VPS", callback_data: `service|${name}|${country}|VPS|${action}` }],
      [{ text: "« Back", callback_data: `nav_service|${name}|${country}|${action}` }]
    ]
  };
  ctx.telegram.editMessageText(ctx.chat.id, msgId, null, "🛠️ Service Type ရွေးချယ်ပါ-", { reply_markup: markup });
}

function sendVpsSubTypeSelection(ctx, msgId, name, country, action) {
  const markup = {
    inline_keyboard: [
      [{ text: "🌐 Outline Manager", callback_data: `vps_sub_choose|${name}|${country}|Outline|${action}` }],
      [{ text: "🖥️ 3X-Ui Panel", callback_data: `vps_sub_choose|${name}|${country}|3XUi|${action}` }],
      [{ text: "« Back", callback_data: `nav_spec|${name}|${country}|VPS|${action}` }]
    ]
  };
  ctx.telegram.editMessageText(ctx.chat.id, msgId, null, "⚙️ VPS အမျိုးအစားကို ထပ်မံရွေးချယ်ပေးပါဦး-", { reply_markup: markup });
}

function sendGBSelection(ctx, msgId, name, country, action) {
  const markup = {
    inline_keyboard: [
      [{ text: "📦 100 GB", callback_data: `gb|${name}|${country}|VPN|100GB|${action}` }, { text: "📦 200 GB", callback_data: `gb|${name}|${country}|VPN|200GB|${action}` }],
      [{ text: "📦 300 GB", callback_data: `gb|${name}|${country}|VPN|300GB|${action}` }, { text: "📦 400 GB", callback_data: `gb|${name}|${country}|VPN|400GB|${action}` }],
      [{ text: "📦 500 GB", callback_data: `gb|${name}|${country}|VPN|500GB|${action}` }, { text: "📦 600 GB", callback_data: `gb|${name}|${country}|VPN|600GB|${action}` }],
      [{ text: "📦 Unlimited Data", callback_data: `gb|${name}|${country}|VPN|Unlimited Data|${action}` }],
      [{ text: "« Back", callback_data: `nav_spec|${name}|${country}|VPN|${action}` }]
    ]
  };
  if (msgId) ctx.telegram.editMessageText(ctx.chat.id, msgId, null, "📊 VPN Data Packages ရွေးချယ်ပါ-", { reply_markup: markup });
  else ctx.reply("📊 VPN Data Packages ရွေးချယ်ပါ-", { reply_markup: markup });
}

function sendTBSelection(ctx, msgId, name, country, subType, action) {
  const markup = {
    inline_keyboard: [
      [{ text: "🚀 1 TB", callback_data: `tb|${name}|${country}|${subType}|1TB|${action}` }, { text: "🚀 2 TB", callback_data: `tb|${name}|${country}|${subType}|2TB|${action}` }],
      [{ text: "🚀 3 TB", callback_data: `tb|${name}|${country}|${subType}|3TB|${action}` }, { text: "🚀 4 TB", callback_data: `tb|${name}|${country}|${subType}|4TB|${action}` }],
      [{ text: "🚀 5 TB", callback_data: `tb|${name}|${country}|${subType}|5TB|${action}` }],
      [{ text: "« Back", callback_data: `service|${name}|${country}|VPS|${action}` }]
    ]
  };
  ctx.telegram.editMessageText(ctx.chat.id, msgId, null, `💾 ${subType} အတွက် Storage/Bandwidth ရွေးပါ-`, { reply_markup: markup });
}

function sendMonthSelection(ctx, msgId, name, country, service, spec, action) {
  let listButtons = [];
  const buildRow = (arr) => arr.map(m => ({ text: m === "unlimited" ? "Unlimited date" : `${m} လ`, callback_data: `month|${name}|${country}|${service}|${spec}|${m}|${action}` }));
  
  listButtons.push(buildRow(["1", "2", "3"]));
  listButtons.push(buildRow(["4", "5", "6"]));
  
  if (service === "VPN" || service === "Outline") {
    listButtons.push(buildRow(["7", "8", "9"]));
    listButtons.push(buildRow(["unlimited"]));
  }
  listButtons.push([{ text: "« Back", callback_data: `nav_spec|${name}|${country}|${service}|${action}` }]);

  ctx.telegram.editMessageText(ctx.chat.id, msgId, null, "📅 သက်တမ်းကာလ (Duration) ရွေးချယ်ပါ-", { reply_markup: { inline_keyboard: listButtons } });
}

function askSellerAdmin(ctx) {
  const markup = {
    inline_keyboard: [
      [{ text: "👤 Owner-HCM", callback_data: "seller_select|Owner-HCM" }],
      [{ text: "👤 Admin-CM", callback_data: "seller_select|Admin-CM" }]
    ]
  };
  ctx.reply("🧑‍💻 ဘယ် Admin က ရောင်းချတာလဲ ရွေးပေးပါဦး-", { reply_markup: markup });
}

// ================= DB CRUD LOGICS =================
async function saveOrRenewUser(ctx, name, country, service, spec, month, action, price, key, webLink, sellerAdmin) {
  const todayStr = getTodayStr();
  let displayPack = `${spec} (${month === "unlimited" ? "Unlimited" : month + "လ"})`;
  if (service === "Outline") displayPack = "Outline " + displayPack;
  if (service === "3XUi") displayPack = "3X-Ui " + displayPack;

  const encodedKey = Buffer.from(key).toString('base64');

  if (action === "add") {
    let finalName = name;
    const { data: existing } = await supabase.from('users_vps').select('name').ilike('name', `${name}%`);
    if (existing && existing.length > 0) {
      const count = existing.length;
      finalName = `${name} (${count < 10 ? "0" + count : count})`;
    }

    let expiryStr = "Unlimited";
    if (month !== "unlimited") {
      let expiry = new Date();
      expiry.setMonth(expiry.getMonth() + parseInt(month));
      expiryStr = formatCustomDate(expiry);
    }

    await supabase.from('users_vps').insert([{
      date_str: todayStr, name: finalName, package: displayPack, expiry: expiryStr, price: price, renew: 0, key_data: encodedKey, web_link: webLink, seller: sellerAdmin
    }]);

    sendSuccessMessage(ctx, service, finalName, displayPack, price, todayStr, expiryStr, key, webLink, sellerAdmin);
  } 
  else if (action === "renew") {
    const { data: user } = await supabase.from('users_vps').select('*').eq('name', name).single();
    if (!user) return ctx.reply("❌ User ရှာမတွေ့တော့ပါ။");

    let baseDate = new Date();
    if (user.expiry && user.expiry !== "Unlimited") {
      const parts = user.expiry.split(" ")[1]?.split("."); // parse 'Sun 5.20.2026'
      if (parts && parts.length === 3) {
        const parsedDate = new Date(parts[2], parts[0] - 1, parts[1]);
        if (parsedDate > baseDate) baseDate = parsedDate;
      }
    }

    let newExpiryStr = "Unlimited";
    if (month !== "unlimited") {
      baseDate.setMonth(baseDate.getMonth() + parseInt(month));
      newExpiryStr = formatCustomDate(baseDate);
    }

    await supabase.from('users_vps').update({
      date_str: todayStr, package: displayPack, expiry: newExpiryStr, price: price, renew: (user.renew + 1), key_data: encodedKey, web_link: webLink, seller: sellerAdmin
    }).eq('name', name);

    sendSuccessMessage(ctx, service, name, displayPack, price, todayStr, newExpiryStr, key, webLink, sellerAdmin);
  }
}

function sendSuccessMessage(ctx, service, name, displayPack, price, todayStr, expiryStr, key, webLink, sellerAdmin) {
  let msg = "";
  if (service === "3XUi") {
    let url = "-", user = "-", pass = "-";
    try {
      const parts = key.split("||");
      url = parts[0].replace("3XURL:", "");
      user = parts[1].replace("3XUSER:", "");
      pass = parts[2].replace("3XPASS:", "");
    } catch(e) {}

    msg = `🖥️ <b>3X-UI PANEL DETAILS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n👤 <b>ဝယ်သူ (User):</b> ${escapeHtml(name)}\n📦 <b>ပက်ကေ့ဂျ် (Package):</b> ${escapeHtml(displayPack)}\n💰 <b>ကျသင့်ငွေ (Price):</b> ${price} MMK\n📅 <b>စတင်ရက် (Start Date):</b> ${todayStr}\n⌛️ <b>သက်တမ်းကုန်ရက် (Expiry):</b> ${expiryStr}\n🧑‍💻 <b>ရောင်းချသူ Admin:</b> ${escapeHtml(sellerAdmin)}\n━━━━━━━━━━━━━━━━━━━━━━━━\n🌐 <b>Access URL:</b> \n<code>${escapeHtml(url)}</code>\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n📌 <i>စာသားများကို ဖိပြီး အလွယ်တကူ Copy ကူးနိုင်ပါသည်။</i>`;
  } else {
    msg = `🌐 <b>DETAILS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n👤 ဝယ်သူ (User): ${escapeHtml(name)}\n📦 ပက်ကေ့ဂျ် (Package): ${escapeHtml(displayPack)}\n💰 ကျသင့်ငွေ (Price): ${price} MMK\n📅 စတင်ရက် (Start Date): ${todayStr}\n⌛️ သက်တမ်းကုန်ရက် (Expiry): ${expiryStr}\n🧑‍💻 ရောင်းချသူ Admin: ${escapeHtml(sellerAdmin)}\n━━━━━━━━━━━━━━━━━━━━━━━━\n🔑 Key:\n<code>${escapeHtml(key)}</code>\n\n📊 Link:\n<code>${escapeHtml(webLink)}</code>\n━━━━━━━━━━━━━━━━━━━━━━━━`;
  }
  ctx.replyWithHTML(msg);
}

async function showUserInfo(ctx, msgId, id) {
  const { data: u } = await supabase.from('users_vps').select('*').eq('id', id).single();
  if (!u) return ctx.reply("❌ User ရှာမတွေ့ပါ။");

  const rawKey = Buffer.from(u.key_data, 'base64').toString('utf-8');
  let keyDisplay = `<code>${escapeHtml(rawKey)}</code>`;
  if (u.package.includes("3X-Ui")) {
    try {
      const parts = rawKey.split("||");
      keyDisplay = `\n🔗 URL: <code>${escapeHtml(parts[0].replace("3XURL:", ""))}</code>\n👤 User: <code>${escapeHtml(parts[1].replace("3XUSER:", ""))}</code>`;
    } catch(e) {}
  }

  const info = `🔎 USER DETAILS\n━━━━━━━━━━━━━━━━━━\n👤 နာမည်: ${u.name}\n📦 အမျိုးအစား: ${u.package}\n💰 ဈေးနှုန်း: ${u.price} MMK\n🔄 Renew : ${u.renew}\n⏳ Expiry : ${u.expiry}\n🔗 Link: <code>${escapeHtml(u.web_link)}</code>\n🧑‍💻 Admin: ${u.seller}\n\n🔑 Key Details: ${keyDisplay}\n━━━━━━━━━━━━━━━━━━`;
  ctx.telegram.editMessageText(ctx.chat.id, msgId, null, info, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "« Back to List", callback_data: "menu_find" }]] } });
}

// ================= REPORT BUILDER =================
function makeSummary(rows) {
  let adminSales = { "Owner-HCM": 0, "Admin-CM": 0 };
  let vpn = 0, vps = 0;
  rows.forEach(r => {
    if (r.seller === "Owner-HCM") adminSales["Owner-HCM"] += r.price;
    if (r.seller === "Admin-CM") adminSales["Admin-CM"] += r.price;
    if (r.package.includes("Outline") || r.package.includes("3X-Ui")) vps++; else vpn++;
  });
  return `\n\n🧑‍💻 ADMIN SALES SUMMARY\n├── Owner-HCM: ${adminSales["Owner-HCM"]} MMK\n└── Admin-CM: ${adminSales["Admin-CM"]} MMK\n\n📦 SERVICE SUMMARY\n├── 🌐 VPN Keys: ${vpn} ခု\n└── 🖥️ VPS (Outline/3X): ${vps} လုံး`;
}

async function handleTodayReport(ctx) {
  const today = getTodayStr();
  const { data: rows } = await supabase.from('users_vps').select('*').eq('date_str', today);
  const total = rows ? rows.reduce((sum, r) => sum + r.price, 0) : 0;
  ctx.reply(`📅 TODAY REPORT (${today})\n\n✨ ရောင်းရဦးရေ: ${rows?.length || 0} ယောက်\n💰 စုစုပေါင်းဝင်ငွေ: ${total} MMK ${makeSummary(rows || [])}`);
}

async function handleMonthlyReport(ctx) {
  const currentMonth = new Date().toISOString().substring(0, 7); // yyyy-mm
  const { data: rows } = await supabase.from('users_vps').select('*').like('date_str', `${currentMonth}%`);
  const total = rows ? rows.reduce((sum, r) => sum + r.price, 0) : 0;
  ctx.reply(`📅 MONTHLY REPORT (${currentMonth})\n\n✨ ယခုလရောင်းရဦးရေ: ${rows?.length || 0} ယောက်\n💰 ယခုလဝင်ငွေ: ${total} MMK ${makeSummary(rows || [])}`);
}

async function handleFullReport(ctx) {
  const { data: rows } = await supabase.from('users_vps').select('*');
  let msg = "📊 ALL TIME REPORT\n━━━━━━━━━━━━━━━━━━\n\n";
  let total = 0;
  if (rows) {
    rows.forEach(r => {
      total += r.price;
      msg += `👤 ${r.name}\n📦 ${r.package}\n💰 ${r.price} MMK\n⏳ Expiry: ${r.expiry}\n----------------------------------\n`;
    });
  }
  msg += `\n✨ စုစုပေါင်း User: ${rows?.length || 0} ယောက်\n💰 စုစုပေါင်း ရရှိပြီးငွေ: ${total} MMK\n━━━━━━━━━━━━━━━━━━ ${makeSummary(rows || [])}`;
  ctx.reply(msg);
}

// ================= EXPRESS WEB SERVER (Render keep-alive) =================
const app = express();
app.get('/', (req, res) => res.send('Bot is Alive & Running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

bot.launch();
