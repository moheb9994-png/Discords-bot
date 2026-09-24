require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

const play = require("play-dl");

// ==================================================
// ENV
// ==================================================

const env = process.env;

if (!env.DISCORD_TOKEN || !env.GUILD_ID) {
  console.error("❌ ضع DISCORD_TOKEN و GUILD_ID في Railway Variables");
  process.exit(1);
}

// ==================================================
// DATA
// ==================================================

const dataDir = path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const productsFile = path.join(dataDir, "products.json");

if (!fs.existsSync(productsFile)) {
  fs.writeFileSync(productsFile, "[]", "utf8");
}

function getProducts() {
  try {
    return JSON.parse(fs.readFileSync(productsFile, "utf8"));
  } catch {
    return [];
  }
}

function saveProducts(products) {
  fs.writeFileSync(
    productsFile,
    JSON.stringify(products, null, 2),
    "utf8"
  );
}

// ==================================================
// CLIENT
// ==================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
  ],
});

// ==================================================
// HELPERS
// ==================================================

function isStaff(interaction) {
  if (!interaction.member) return false;

  if (
    interaction.member.permissions &&
    interaction.member.permissions.has(
      PermissionFlagsBits.ManageGuild
    )
  ) {
    return true;
  }

  if (
    env.STAFF_ROLE_ID &&
    interaction.member.roles &&
    interaction.member.roles.cache.has(env.STAFF_ROLE_ID)
  ) {
    return true;
  }

  return false;
}

function safeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 20) || "user";
}

function getTicketType(channel) {
  if (!channel || !channel.topic) return null;

  if (channel.topic.startsWith("ticket:purchase:")) {
    return "purchase";
  }

  if (channel.topic.startsWith("ticket:support:")) {
    return "support";
  }

  return null;
}

function getTicketOwner(channel) {
  if (!channel || !channel.topic) return null;

  const parts = channel.topic.split(":");

  return parts[2] || null;
}

// ==================================================
// MUSIC
// ==================================================

const musicQueues = new Map();

function getQueue(guildId) {
  if (!musicQueues.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });

    const queue = {
      songs: [],
      player,
      connection: null,
      playing: false,
    };

    player.on(AudioPlayerStatus.Idle, async () => {
      const q = musicQueues.get(guildId);

      if (!q) return;

      if (q.songs.length) {
        q.songs.shift();
      }

      if (q.songs.length) {
        try {
          const guild = client.guilds.cache.get(guildId);

          if (guild) {
            await playNext(guild);
          }
        } catch (error) {
          console.error("Music next error:", error);
        }
      } else {
        q.playing = false;
      }
    });

    player.on("error", async error => {
      console.error("❌ Music player error:", error);

      const q = musicQueues.get(guildId);

      if (!q) return;

      if (q.songs.length) {
        q.songs.shift();
      }

      q.playing = false;

      const guild = client.guilds.cache.get(guildId);

      if (guild && q.songs.length) {
        await playNext(guild).catch(console.error);
      }
    });

    musicQueues.set(guildId, queue);
  }

  return musicQueues.get(guildId);
}

async function playNext(guild) {
  const queue = getQueue(guild.id);

  if (!queue.songs.length) {
    queue.playing = false;
    return;
  }

  const song = queue.songs[0];

  try {
    const stream = await play.stream(song.url, {
      discordPlayerCompatibility: true,
    });

    const resource = createAudioResource(
      stream.stream,
      {
        inputType: stream.type,
      }
    );

    queue.player.play(resource);
    queue.playing = true;

    stream.stream.on("error", error => {
      console.error("❌ Stream error:", error);

      if (queue.songs.length) {
        queue.songs.shift();
      }

      queue.playing = false;

      playNext(guild).catch(console.error);
    });

  } catch (error) {
    console.error("❌ Music error:", error);

    if (queue.songs.length) {
      queue.songs.shift();
    }

    queue.playing = false;

    if (queue.songs.length) {
      await playNext(guild);
    }
  }
}

// ==================================================
// 24/7 VOICE
// ==================================================

let voice247Connection = null;
let voice247ChannelId = null;
let voice247GuildId = null;

async function connect247() {
  if (!env.VOICE_247_CHANNEL_ID) {
    console.log("ℹ️ VOICE_247_CHANNEL_ID غير موجود.");
    return;
  }

  const guild = client.guilds.cache.get(env.GUILD_ID);

  if (!guild) {
    console.log("❌ السيرفر غير موجود.");
    return;
  }

  const channel = guild.channels.cache.get(
    env.VOICE_247_CHANNEL_ID
  );

  if (
    !channel ||
    channel.type !== ChannelType.GuildVoice
  ) {
    console.log("❌ روم 24/7 غير موجود أو ليس روم صوتي.");
    return;
  }

  try {
    if (voice247Connection) {
      try {
        voice247Connection.destroy();
      } catch {}
    }

    voice247Connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    voice247ChannelId = channel.id;
    voice247GuildId = guild.id;

    console.log(
      `🔊 دخل البوت روم 24/7: ${channel.name}`
    );

    voice247Connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        console.log("⚠️ انقطع اتصال 24/7، إعادة الاتصال...");

        setTimeout(() => {
          connect247().catch(console.error);
        }, 5000);
      }
    );

    voice247Connection.on(
      VoiceConnectionStatus.Destroyed,
      () => {
        console.log("⚠️ اتصال 24/7 انحذف.");
      }
    );

  } catch (error) {
    console.error("❌ خطأ 24/7:", error);

    setTimeout(() => {
      connect247().catch(console.error);
    }, 10000);
  }
}

// ==================================================
// COMMANDS
// ==================================================

const commands = [

  // STORE
  new SlashCommandBuilder()
    .setName("store")
    .setDescription("عرض لوحة المتجر"),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("إرسال لوحة المتجر")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  // PRODUCTS
  new SlashCommandBuilder()
    .setName("products")
    .setDescription("عرض المنتجات"),

  new SlashCommandBuilder()
    .setName("addproduct")
    .setDescription("إضافة منتج")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(o =>
      o
        .setName("name")
        .setDescription("اسم المنتج")
        .setRequired(true)
    )
    .addNumberOption(o =>
      o
        .setName("price")
        .setDescription("السعر")
        .setRequired(true)
        .setMinValue(0)
    )
    .addIntegerOption(o =>
      o
        .setName("stock")
        .setDescription("المخزون")
        .setRequired(true)
        .setMinValue(0)
    )
    .addStringOption(o =>
      o
        .setName("description")
        .setDescription("وصف المنتج")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("removeproduct")
    .setDescription("حذف منتج")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(o =>
      o
        .setName("id")
        .setDescription("ID المنتج")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("editproduct")
    .setDescription("تعديل منتج")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(o =>
      o
        .setName("id")
        .setDescription("ID المنتج")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("name")
        .setDescription("الاسم الجديد")
    )
    .addNumberOption(o =>
      o
        .setName("price")
        .setDescription("السعر الجديد")
        .setMinValue(0)
    )
    .addIntegerOption(o =>
      o
        .setName("stock")
        .setDescription("المخزون الجديد")
        .setMinValue(0)
    )
    .addStringOption(o =>
      o
        .setName("description")
        .setDescription("الوصف الجديد")
    ),

  new SlashCommandBuilder()
    .setName("stock")
    .setDescription("عرض المخزون")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  // TICKETS
  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("إرسال لوحة التكتات")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  // MODERATION
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("حظر عضو")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.BanMembers
    )
    .addUserOption(o =>
      o
        .setName("user")
        .setDescription("العضو")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("reason")
        .setDescription("السبب")
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("طرد عضو")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.KickMembers
    )
    .addUserOption(o =>
      o
        .setName("user")
        .setDescription("العضو")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("reason")
        .setDescription("السبب")
    ),

  // MUSIC
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("تشغيل أغنية")
    .addStringOption(o =>
      o
        .setName("song")
        .setDescription("اسم الأغنية أو الرابط")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("تخطي الأغنية"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("إيقاف الموسيقى"),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("إيقاف مؤقت"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("استكمال الأغنية"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("عرض قائمة الأغاني"),

  new SlashCommandBuilder()
    .setName("247")
    .setDescription("دخول روم 24/7"),

].map(c => c.toJSON());

// ==================================================
// STORE PANEL - COMPONENTS V2
// ==================================================

function createStorePanel() {

  const guildIcon =
    client.guilds.cache
      .get(env.GUILD_ID)
      ?.iconURL({
        extension: "png",
        size: 256,
      });

  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# 🛒 ${env.STORE_NAME || "Soork Store"}\n` +
      `مرحباً بك في متجرنا 👋\n\n` +
      `اختر نوع التكت من الأسفل لفتح طلبك.`
    )
  );

  if (guildIcon) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "**🛒 شراء**\n" +
            "لفتح تكت شراء واختيار المنتج."
          )
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId("ticket_purchase")
            .setLabel("شراء")
            .setEmoji("🛒")
            .setStyle(ButtonStyle.Primary)
        )
    );

    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "**🎧 دعم فني**\n" +
            "للتواصل مع الإدارة وطلب المساعدة."
          )
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId("ticket_support")
            .setLabel("دعم فني")
            .setEmoji("🎧")
            .setStyle(ButtonStyle.Secondary)
        )
    );
  } else {

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_purchase")
          .setLabel("شراء")
          .setEmoji("🛒")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("ticket_support")
          .setLabel("دعم فني")
          .setEmoji("🎧")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return container;
}

// ==================================================
// TICKET BUTTONS
// ==================================================

function ticketButtons(type) {

  const row1 =
    new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("استلام التكت")
        .setEmoji("📌")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("ticket_rename")
        .setLabel("تغيير الاسم")
        .setEmoji("✏️")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("إغلاق")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

  if (type === "purchase") {

    const row2 =
      new ActionRowBuilder().addComponents(

        new ButtonBuilder()
          .setCustomId("show_products")
          .setLabel("اختيار المنتج")
          .setEmoji("🛒")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("show_iban")
          .setLabel("الآيبان")
          .setEmoji("💳")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId("payment_proof")
          .setLabel("إثبات الدفع")
          .setEmoji("📤")
          .setStyle(ButtonStyle.Success)
      );

    return [row1, row2];
  }

  return [row1];
}

// ==================================================
// TICKET EMBED
// ==================================================

function createPurchaseEmbed(userId) {

  return new EmbedBuilder()
    .setTitle("🛒 تكت شراء")
    .setDescription(
      `أهلًا <@${userId}> 👋\n\n` +
      "هذا تكت شراء.\n\n" +
      "🛒 اضغط **اختيار المنتج** لاختيار المنتج.\n" +
      "💳 بعد اختيار المنتج يمكنك مشاهدة الآيبان.\n" +
      "📤 بعد التحويل أرسل إثبات الدفع."
    )
    .setFooter({
      text: env.STORE_NAME || "Soork Store",
    });
}

function createSupportEmbed(userId) {

  return new EmbedBuilder()
    .setTitle("🎧 تكت دعم فني")
    .setDescription(
      `أهلًا <@${userId}> 👋\n\n` +
      "اكتب مشكلتك أو استفسارك هنا.\n" +
      "سيتم الرد عليك من الإدارة بأقرب وقت."
    )
    .setFooter({
      text: env.STORE_NAME || "Soork Store",
    });
}

// ==================================================
// READY
// ==================================================

client.once("ready", async () => {

  console.log(
    `✅ Logged in as ${client.user.tag}`
  );

  try {

    const rest =
      new REST({ version: "10" })
        .setToken(env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        env.GUILD_ID
      ),
      {
        body: commands,
      }
    );

    console.log(
      "✅ تم تسجيل جميع الأوامر"
    );

  } catch (error) {

    console.error(
      "❌ خطأ تسجيل الأوامر:",
      error
    );
  }

  // 24/7
  if (env.VOICE_247_CHANNEL_ID) {
    setTimeout(() => {
      connect247().catch(console.error);
    }, 3000);
  }
});

// ==================================================
// INTERACTIONS
// ==================================================

client.on(
  "interactionCreate",
  async interaction => {

    try {

      // ==================================================
      // SLASH COMMANDS
      // ==================================================

      if (interaction.isChatInputCommand()) {

        // ================= STORE =================

        if (
          interaction.commandName === "store" ||
          interaction.commandName === "setup"
        ) {

          if (
            interaction.commandName === "setup" &&
            !isStaff(interaction)
          ) {

            return interaction.reply({
              content:
                "❌ هذا الأمر للإدارة فقط.",
              ephemeral: true,
            });
          }

          if (
            interaction.commandName === "store"
          ) {

            return interaction.reply({
              flags: MessageFlags.IsComponentsV2,
              components: [
                createStorePanel(),
              ],
            });
          }

          return interaction.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [
              createStorePanel(),
            ],
          });
        }

        // ================= TICKET PANEL =================

        if (
          interaction.commandName === "ticketpanel"
        ) {

          if (!isStaff(interaction)) {
            return interaction.reply({
              content:
                "❌ هذا الأمر للإدارة فقط.",
              ephemeral: true,
            });
          }

          return interaction.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [
              createStorePanel(),
            ],
          });
        }

        // ================= PRODUCTS =================

        if (
          interaction.commandName === "products"
        ) {

          const products =
            getProducts();

          if (!products.length) {
            return interaction.reply({
              content:
                "📦 لا توجد منتجات حالياً.",
              ephemeral: true,
            });
          }

          const text =
            products
              .map(p =>
                `📦 **${p.name}**\n` +
                `🆔 \`${p.id}\`\n` +
                `💰 ${p.price} ريال\n` +
                `📊 المخزون: ${p.stock}\n` +
                `📝 ${p.description || "بدون وصف"}`
              )
              .join("\n\n");

          return interaction.reply({
            content:
              text.slice(0, 4000),
            ephemeral: true,
          });
        }

        // ================= ADD PRODUCT =================

        if (
          interaction.commandName === "addproduct"
        ) {

          if (!isStaff(interaction)) {
            return interaction.reply({
              content:
                "❌ للإدارة فقط.",
              ephemeral: true,
            });
          }

          const name =
            interaction.options.getString(
              "name"
            );

          const price =
            interaction.options.getNumber(
              "price"
            );

          const stock =
            interaction.options.getInteger(
              "stock"
            );

          const description =
            interaction.options.getString(
              "description"
            ) || "بدون وصف";

          const products =
            getProducts();

          const product = {
            id:
              Date.now().toString(36) +
              Math.random()
                .toString(36)
                .slice(2, 7),

            name,
            price,
            stock,
            description,
          };

          products.push(product);

          saveProducts(products);

          return interaction.reply({
            content:
              `✅ تم إضافة المنتج\n\n` +
              `📦 ${name}\n` +
              `💰 ${price} ريال\n` +
              `📊 ${stock}\n` +
              `🆔 \`${product.id}\``,
            ephemeral: true,
          });
        }

        // ================= REMOVE PRODUCT =================

        if (
          interaction.commandName ===
          "removeproduct"
        ) {

          if (!isStaff(interaction)) {
            return interaction.reply({
              content:
                "❌ للإدارة فقط.",
              ephemeral: true,
            });
          }

          const id =
            interaction.options.getString(
              "id"
            );

          const products =
            getProducts();

          const index =
            products.findIndex(
              p => p.id === id
            );

          if (index === -1) {
            return interaction.reply({
              content:
                "❌ المنتج غير موجود.",
              ephemeral: true,
            });
          }

          const removed =
            products.splice(index, 1)[0];

          saveProducts(products);

          return interaction.reply({
            content:
              `🗑️ تم حذف **${removed.name}**`,
            ephemeral: true,
          });
        }

        // ================= EDIT PRODUCT =================

        if (
          interaction.commandName ===
          "editproduct"
        ) {

          if (!isStaff(interaction)) {
            return interaction.reply({
              content:
                "❌ للإدارة فقط.",
              ephemeral: true,
            });
          }

          const id =
            interaction.options.getString(
              "id"
            );

          const products =
            getProducts();

          const product =
            products.find(
              p => p.id === id
            );

          if (!product) {
            return interaction.reply({
              content:
                "❌ المنتج غير موجود.",
              ephemeral: true,
            });
          }

          const name =
            interaction.options.getString(
              "name"
            );

          const price =
            interaction.options.getNumber(
              "price"
            );

          const stock =
            interaction.options.getInteger(
              "stock"
            );

          const description =
            interaction.options.getString(
              "description"
            );

          if (name !== null)
            product.name = name;

          if (price !== null)
            product.price = price;

          if (stock !== null)
            product.stock = stock;

          if (description !== null)
            product.description =
              description;

          saveProducts(products);

          return interaction.reply({
            content:
              `✅ تم تعديل المنتج\n\n` +
              `📦 ${product.name}\n` +
              `💰 ${product.price} ريال\n` +
              `📊 ${product.stock}`,
            ephemeral: true,
          });
        }

        // ================= STOCK =================

        if (
          interaction.commandName === "stock"
        ) {

          if (!isStaff(interaction)) {
            return interaction.reply({
              content:
                "❌ للإدارة فقط.",
              ephemeral: true,
            });
          }

          const products =
            getProducts();

          if (!products.length) {
            return interaction.reply({
              content:
                "📦 لا توجد منتجات.",
              ephemeral: true,
            });
          }

          const text =
            products
              .map(p =>
                `📦 **${p.name}** — ${p.stock} قطعة\n` +
                `🆔 \`${p.id}\``
              )
              .join("\n\n");

          return interaction.reply({
            content:
              `📊 **مخزون المتجر**\n\n${text}`,
            ephemeral: true,
          });
        }

        // ================= BAN =================

        if (
          interaction.commandName === "ban"
        ) {

          const user =
            interaction.options.getUser(
              "user"
            );

          const reason =
            interaction.options.getString(
              "reason"
            ) || "بدون سبب";

          try {

            await interaction.guild.members.ban(
              user.id,
              { reason }
            );

            return interaction.reply(
              `🔨 تم حظر **${user.tag}**\nالسبب: ${reason}`
            );

          } catch {

            return interaction.reply({
              content:
                "❌ ما قدرت أحظر العضو.",
              ephemeral: true,
            });
          }
        }

        // ================= KICK =================

        if (
          interaction.commandName === "kick"
        ) {

          const user =
            interaction.options.getUser(
              "user"
            );

          const reason =
            interaction.options.getString(
              "reason"
            ) || "بدون سبب";

          const member =
            await interaction.guild.members
              .fetch(user.id)
              .catch(() => null);

          if (!member) {
            return interaction.reply({
              content:
                "❌ العضو غير موجود.",
              ephemeral: true,
            });
          }

          try {

            await member.kick(reason);

            return interaction.reply(
              `👢 تم طرد **${user.tag}**\nالسبب: ${reason}`
            );

          } catch {

            return interaction.reply({
              content:
                "❌ ما قدرت أطرد العضو.",
              ephemeral: true,
            });
          }
        }

        // ================= 247 =================

        if (
          interaction.commandName === "247"
        ) {

          if (!isStaff(interaction)) {
            return interaction.reply({
              content:
                "❌ هذا الأمر للإدارة فقط.",
              ephemeral: true,
            });
          }

          await connect247();

          return interaction.reply({
            content:
              "🔊 تم تشغيل نظام 24/7.",
            ephemeral: true,
          });
        }

        // ================= PLAY =================

        if (
          interaction.commandName === "play"
        ) {

          const voiceChannel =
            interaction.member.voice.channel;

          if (!voiceChannel) {
            return interaction.reply({
              content:
                "❌ ادخل روم صوتي أولاً.",
              ephemeral: true,
            });
          }

          const query =
            interaction.options.getString(
              "song"
            );

          await interaction.deferReply();

          try {

            let result;

            if (
              play.yt_validate(query) ===
              "video"
            ) {

              result = {
                url: query,
                title: "YouTube",
              };

            } else {

              const search =
                await play.search(
                  query,
                  {
                    limit: 1,
                    source: {
                      youtube: "video",
                    },
                  }
                );

              if (!search.length) {
                return interaction.editReply(
                  "❌ ما لقيت الأغنية."
                );
              }

              result = {
                url: search[0].url,
                title: search[0].title,
              };
            }

            const queue =
              getQueue(
                interaction.guild.id
              );

            if (!queue.connection) {

              queue.connection =
                joinVoiceChannel({
                  channelId:
                    voiceChannel.id,

                  guildId:
                    interaction.guild.id,

                  adapterCreator:
                    interaction.guild
                      .voiceAdapterCreator,

                  selfDeaf: false,
                  selfMute: false,
                });

              queue.connection.subscribe(
                queue.player
              );
            }

            queue.songs.push(result);

            if (!queue.playing) {
              await playNext(
                interaction.guild
              );
            }

            return interaction.editReply(
              `🎵 تمت إضافة **${result.title}** إلى القائمة.`
            );

          } catch (error) {

            console.error(error);

            return interaction.editReply(
              "❌ حصل خطأ أثناء تشغيل الأغنية."
            );
          }
        }

        // ================= SKIP =================

        if (
          interaction.commandName === "skip"
        ) {

          const queue =
            musicQueues.get(
              interaction.guild.id
            );

          if (
            !queue ||
            !queue.songs.length
          ) {
            return interaction.reply(
              "❌ ما فيه أغنية."
            );
          }

          queue.player.stop();

          return interaction.reply(
            "⏭️ تم التخطي."
          );
        }

        // ================= STOP =================

        if (
          interaction.commandName === "stop"
        ) {

          const queue =
            musicQueues.get(
              interaction.guild.id
            );

          if (!queue) {
            return interaction.reply(
              "❌ ما فيه موسيقى."
            );
          }

          queue.songs = [];

          queue.player.stop();

          if (queue.connection) {
            queue.connection.destroy();
            queue.connection = null;
          }

          queue.playing = false;

          return interaction.reply(
            "⏹️ تم إيقاف الموسيقى."
          );
        }

        // ================= PAUSE =================

        if (
          interaction.commandName === "pause"
        ) {

          const queue =
            musicQueues.get(
              interaction.guild.id
            );

          if (!queue) {
            return interaction.reply(
              "❌ ما فيه موسيقى."
            );
          }

          queue.player.pause();

          return interaction.reply(
            "⏸️ تم الإيقاف المؤقت."
          );
        }

        // ================= RESUME =================

        if (
          interaction.commandName === "resume"
        ) {

          const queue =
            musicQueues.get(
              interaction.guild.id
            );

          if (!queue) {
            return interaction.reply(
              "❌ ما فيه موسيقى."
            );
          }

          queue.player.unpause();

          return interaction.reply(
            "▶️ تم الاستكمال."
          );
        }

        // ================= QUEUE =================

        if (
          interaction.commandName === "queue"
        ) {

          const queue =
            musicQueues.get(
              interaction.guild.id
            );

          if (
            !queue ||
            !queue.songs.length
          ) {
            return interaction.reply(
              "📭 القائمة فارغة."
            );
          }

          const text =
            queue.songs
              .map(
                (song, index) =>
                  `${index + 1}. ${song.title}`
              )
              .join("\n");

          return interaction.reply(
            `🎵 **قائمة الأغاني**\n\n${text}`
          );
        }

        return;
      }

      // ==================================================
      // BUTTONS
      // ==================================================

      if (interaction.isButton()) {

        // ================= OPEN PURCHASE =================

        if (
          interaction.customId ===
          "ticket_purchase"
        ) {

          const existing =
            interaction.guild.channels.cache.find(
              c =>
                c.topic ===
                `ticket:purchase:${interaction.user.id}`
            );

          if (existing) {
            return interaction.reply({
              content:
                `🛒 عندك تكت شراء مفتوح بالفعل: ${existing}`,
              ephemeral: true,
            });
          }

          await interaction.deferReply({
            ephemeral: true,
          });

          const overwrites = [

            {
              id:
                interaction.guild.roles.everyone.id,

              deny: [
                PermissionFlagsBits.ViewChannel,
              ],
            },

            {
              id:
                interaction.user.id,

              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
              ],
            },
          ];

          if (env.STAFF_ROLE_ID) {

            overwrites.push({
              id:
                env.STAFF_ROLE_ID,

              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ManageChannels,
              ],
            });
          }

          const channel =
            await interaction.guild.channels.create({

              name:
                `شراء-${safeName(
                  interaction.user.username
                )}`,

              type:
                ChannelType.GuildText,

              parent:
                env.TICKET_CATEGORY_ID ||
                null,

              topic:
                `ticket:purchase:${interaction.user.id}`,

              permissionOverwrites:
                overwrites,
            });

          await channel.send({

            content:
              `<@${interaction.user.id}>` +
              (
                env.STAFF_ROLE_ID
                  ? ` <@&${env.STAFF_ROLE_ID}>`
                  : ""
              ),

            embeds: [
              createPurchaseEmbed(
                interaction.user.id
              ),
            ],

            components:
              ticketButtons("purchase"),
          });

          return interaction.editReply({
            content:
              `✅ تم فتح تكت الشراء: ${channel}`,
          });
        }

        // ================= OPEN SUPPORT =================

        if (
          interaction.customId ===
          "ticket_support"
        ) {

          const existing =
            interaction.guild.channels.cache.find(
              c =>
                c.topic ===
                `ticket:support:${interaction.user.id}`
            );

          if (existing) {
            return interaction.reply({
              content:
                `🎧 عندك تكت دعم مفتوح بالفعل: ${existing}`,
              ephemeral: true,
            });
          }

          await interaction.deferReply({
            ephemeral: true,
          });

          const overwrites = [

            {
              id:
                interaction.guild.roles.everyone.id,

              deny: [
                PermissionFlagsBits.ViewChannel,
              ],
            },

            {
              id:
                interaction.user.id,

              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
          ];

          if (env.STAFF_ROLE_ID) {

            overwrites.push({
              id:
                env.STAFF_ROLE_ID,

              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
              ],
            });
          }

          const channel =
            await interaction.guild.channels.create({

              name:
                `دعم-${safeName(
                  interaction.user.username
                )}`,

              type:
                ChannelType.GuildText,

              parent:
                env.TICKET_CATEGORY_ID ||
                null,

              topic:
                `ticket:support:${interaction.user.id}`,

              permissionOverwrites:
                overwrites,
            });

          await channel.send({

            content:
              `<@${interaction.user.id}>` +
              (
                env.STAFF_ROLE_ID
                  ? ` <@&${env.STAFF_ROLE_ID}>`
                  : ""
              ),

            embeds: [
              createSupportEmbed(
                interaction.user.id
              ),
            ],

            components:
              ticketButtons("support"),
          });

          return interaction.editReply({
            content:
              `✅ تم فتح تكت الدعم: ${channel}`,
          });
        }

        // ================= CLAIM =================

        if (
          interaction.customId ===
          "ticket_claim"
        ) {

          if (!isStaff(interaction)) {
            return interaction.reply({
              content:
                "❌ هذا الزر للإدارة فقط.",
              ephemeral: true,
            });
          }

          await interaction.reply({
            content:
              `📌 تم استلام التكت بواسطة <@${interaction.user.id}>.`,
          });

          return;
        }

        // ================= RENAME =================

        if (
          interaction.customId ===
          "ticket_rename"
        ) {

          if (!isStaff(interaction)) {
            return interaction.reply({
              content:
                "❌ هذا الزر للإدارة فقط.",
              ephemeral: true,
            });
          }

          return interaction.reply({
            content:
              "✏️ اكتب الاسم الجديد للتكت في رسالة هنا.\nمثال: `شراء-امجد`",
            ephemeral: true,
          });
        }

        // ================= IBAN =================

        if (
          interaction.customId ===
          "show_iban"
        ) {

          if (
            getTicketType(
              interaction.channel
            ) !== "purchase"
          ) {

            return interaction.reply({
              content:
                "❌ الآيبان متوفر في تكتات الشراء فقط.",
              ephemeral: true,
            });
          }

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("💳 بيانات التحويل")
                .setDescription(
                  `**البنك:** ${
                    env.RAJHI_BANK_NAME ||
                    "مصرف الراجحي"
                  }\n\n` +

                  `**اسم صاحب الحساب:** ${
                    env.RAJHI_ACCOUNT_NAME ||
                    "غير مضبوط"
                  }\n\n` +

                  `**الآيبان:**\n` +
                  `\`${env.RAJHI_IBAN || "غير مضبوط"}\`\n\n` +

                  "⚠️ لا تعتبر العملية مكتملة حتى يتم تأكيد الدفع من الإدارة."
                ),
            ],
            ephemeral: true,
          });
        }

        // ================= PRODUCTS =================

        if (
          interaction.customId ===
          "show_products"
        ) {

          if (
            getTicketType(
              interaction.channel
            ) !== "purchase"
          ) {
            return interaction.reply({
              content:
                "❌ المنتجات متوفرة في تكتات الشراء فقط.",
              ephemeral: true,
            });
          }

          const products =
            getProducts()
              .filter(
                p =>
                  Number(p.stock) > 0
              )
              .slice(0, 25);

          if (!products.length) {
            return interaction.reply({
              content:
                "📦 لا توجد منتجات متوفرة حالياً.",
              ephemeral: true,
            });
          }

          const menu =
            new StringSelectMenuBuilder()
              .setCustomId(
                "select_ticket_product"
              )
              .setPlaceholder(
                "🛒 اختر المنتج"
              );

          menu.addOptions(
            products.map(p =>
              new StringSelectMenuOptionBuilder()
                .setLabel(
                  `${p.name} - ${p.price} ريال`
                    .slice(0, 100)
                )
                .setDescription(
                  String(
                    p.description ||
                    "بدون وصف"
                  ).slice(0, 100)
                )
                .setValue(p.id)
            )
          );

          return interaction.reply({
            content:
              "🛒 اختر المنتج الذي تريده:",
            components: [
              new ActionRowBuilder()
                .addComponents(menu),
            ],
            ephemeral: true,
          });
        }

        // ================= PAYMENT PROOF =================

        if (
          interaction.customId ===
          "payment_proof"
        ) {

          if (
            getTicketType(
              interaction.channel
            ) !== "purchase"
          ) {

            return interaction.reply({
              content:
                "❌ إثبات الدفع متوفر في تكتات الشراء فقط.",
              ephemeral: true,
            });
          }

          return interaction.reply({
            content:
              "📤 أرسل صورة أو ملف إثبات التحويل داخل التكت.\n\n" +
              "بعد الإرسال راح يظهر للإدارة لمراجعته.",
            ephemeral: true,
          });
        }

        // ================= CLOSE =================

        if (
          interaction.customId ===
          "ticket_close"
        ) {

          if (!isStaff(interaction)) {

            const owner =
              getTicketOwner(
                interaction.channel
              );

            if (
              owner !==
              interaction.user.id
            ) {
              return interaction.reply({
                content:
                  "❌ ما تقدر تقفل هذا التكت.",
                ephemeral: true,
              });
            }
          }

          await interaction.reply({
            content:
              "🔒 سيتم إغلاق التكت خلال 5 ثوانٍ.",
          });

          setTimeout(() => {

            interaction.channel
              .delete()
              .catch(() => {});

          }, 5000);

          return;
        }
      }

      // ==================================================
      // SELECT MENU
      // ==================================================

      if (
        interaction.isStringSelectMenu()
      ) {

        if (
          interaction.customId ===
          "select_ticket_product"
        ) {

          const productId =
            interaction.values[0];

          const products =
            getProducts();

          const product =
            products.find(
              p =>
                p.id === productId
            );

          if (!product) {
            return interaction.update({
              content:
                "❌ المنتج غير موجود.",
              components: [],
            });
          }

          if (
            Number(product.stock) <= 0
          ) {
            return interaction.update({
              content:
                "❌ المنتج نفد من المخزون.",
              components: [],
            });
          }

          await interaction.update({
            content:
              `✅ تم اختيار المنتج:\n\n` +
              `🛒 **${product.name}**\n` +
              `💰 السعر: **${product.price} ريال**\n` +
              `📦 المخزون: **${product.stock}**`,
            components: [],
          });

          await interaction.channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("🛒 المنتج المختار")
                .setDescription(
                  `**المنتج:** ${product.name}\n` +
                  `**السعر:** ${product.price} ريال\n` +
                  `**اختاره:** <@${interaction.user.id}>\n\n` +
                  "💳 اضغط زر **الآيبان** لمعرفة بيانات التحويل.\n" +
                  "📤 بعد التحويل أرسل إثبات الدفع."
                ),
            ],
          });

          return;
        }
      }

    } catch (error) {

      console.error(
        "❌ Interaction Error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await interaction.reply({
          content:
            "❌ حدث خطأ غير متوقع.",
          ephemeral: true,
        }).catch(() => {});
      }
    }
  }
);

// ==================================================
// MESSAGE CREATE
// ==================================================

client.on(
  "messageCreate",
  async message => {

    if (message.author.bot)
      return;

    const channel =
      message.channel;

    // ================= RENAME =================

    if (
      getTicketType(channel) &&
      isStaff({
        member: message.member,
      }) &&
      channel.topic
    ) {

      if (
        message.content.startsWith("اسم:")
      ) {

        const newName =
          message.content
            .replace("اسم:", "")
            .trim();

        if (
          newName &&
          newName.length <= 90
        ) {

          await channel
            .setName(
              safeName(newName)
            )
            .catch(() => {});

          await message.reply(
            `✅ تم تغيير اسم التكت إلى **${safeName(newName)}**`
          );
        }

        return;
      }
    }

    // ================= PAYMENT PROOF =================

    if (
      getTicketType(channel) !==
      "purchase"
    ) {
      return;
    }

    if (
      !message.attachments.size
    ) {
      return;
    }

    const files =
      [...message.attachments.values()]
        .map(
          a => a.url
        )
        .join("\n");

    const embed =
      new EmbedBuilder()
        .setTitle(
          "📤 إثبات دفع جديد"
        )
        .setDescription(
          `**المرسل:** <@${message.author.id}>\n\n` +
          `تم إرسال إثبات دفع في تكت شراء.\n\n` +
          files
        )
        .setFooter({
          text:
            "راجع التحويل ثم تأكد من الدفع.",
        });

    if (
      env.STAFF_ROLE_ID
    ) {

      await channel.send({
        content:
          `<@&${env.STAFF_ROLE_ID}>`,
        embeds: [
          embed,
        ],
      });

    } else {

      await channel.send({
        embeds: [
          embed,
        ],
      });
    }
  }
);

// ==================================================
// 24/7 RECONNECT CHECK
// ==================================================

setInterval(
  async () => {

    if (
      !env.VOICE_247_CHANNEL_ID
    ) {
      return;
    }

    const guild =
      client.guilds.cache.get(
        env.GUILD_ID
      );

    if (!guild) return;

    const channel =
      guild.channels.cache.get(
        env.VOICE_247_CHANNEL_ID
      );

    if (!channel) return;

    const me =
      guild.members.me;

    if (!me) return;

    const currentChannel =
      me.voice.channel;

    if (
      !currentChannel ||
      currentChannel.id !==
      env.VOICE_247_CHANNEL_ID
    ) {

      console.log(
        "🔊 البوت ليس في روم 24/7، إعادة الدخول..."
      );

      await connect247().catch(
        console.error
      );
    }

  },
  30000
);

// ==================================================
// LOGIN
// ==================================================

client.login(
  env.DISCORD_TOKEN
);
