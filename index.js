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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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
  entersState,
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
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

// ==================================================
// PERMISSIONS
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

    musicQueues.set(guildId, {
      songs: [],
      player,
      connection: null,
      playing: false,
    });

    player.on(AudioPlayerStatus.Idle, async () => {
      const queue = musicQueues.get(guildId);

      if (!queue) return;

      if (queue.songs.length) {
        queue.songs.shift();
      }

      if (queue.songs.length) {
        const guild = client.guilds.cache.get(guildId);

        if (guild) {
          await playNext(guild).catch(console.error);
        }
      } else {
        queue.playing = false;
      }
    });

    player.on("error", async error => {
      console.error("❌ Music player error:", error);

      const queue = musicQueues.get(guildId);

      if (!queue) return;

      if (queue.songs.length) {
        queue.songs.shift();
      }

      const guild = client.guilds.cache.get(guildId);

      if (guild && queue.songs.length) {
        await playNext(guild).catch(console.error);
      } else {
        queue.playing = false;
      }
    });
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

    stream.stream.on("error", async error => {
      console.error("❌ Stream error:", error);

      if (queue.songs.length) {
        queue.songs.shift();
      }

      await playNext(guild).catch(console.error);
    });

  } catch (error) {
    console.error("❌ Music error:", error);

    if (queue.songs.length) {
      queue.songs.shift();
    }

    if (queue.songs.length) {
      await playNext(guild).catch(console.error);
    } else {
      queue.playing = false;
    }
  }
}

// ==================================================
// 24/7 VOICE
// ==================================================

let voice247Connection = null;

async function connect247() {
  try {
    if (!env.VOICE_247_CHANNEL_ID) {
      console.log(
        "ℹ️ VOICE_247_CHANNEL_ID غير موجود - تم تخطي نظام 24/7"
      );
      return;
    }

    const guild = client.guilds.cache.get(env.GUILD_ID);

    if (!guild) {
      console.log("❌ البوت غير موجود في السيرفر المحدد.");
      return;
    }

    const channel = guild.channels.cache.get(
      env.VOICE_247_CHANNEL_ID
    );

    if (
      !channel ||
      channel.type !== ChannelType.GuildVoice
    ) {
      console.log(
        "❌ VOICE_247_CHANNEL_ID غير صحيح أو الروم ليس صوتيًا."
      );
      return;
    }

    if (
      voice247Connection &&
      voice247Connection.state.status !==
        VoiceConnectionStatus.Destroyed
    ) {
      return;
    }

    voice247Connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    voice247Connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        console.log("⚠️ اتصال 24/7 انقطع...");

        try {
          await Promise.race([
            entersState(
              voice247Connection,
              VoiceConnectionStatus.Signalling,
              5000
            ),
            entersState(
              voice247Connection,
              VoiceConnectionStatus.Connecting,
              5000
            ),
          ]);

          console.log("✅ تم استعادة اتصال 24/7");

        } catch {
          console.log(
            "🔄 إعادة الاتصال بروم 24/7..."
          );

          try {
            voice247Connection.destroy();
          } catch {}

          voice247Connection = null;

          setTimeout(() => {
            connect247().catch(console.error);
          }, 3000);
        }
      }
    );

    voice247Connection.on(
      VoiceConnectionStatus.Destroyed,
      () => {
        voice247Connection = null;
      }
    );

    console.log(
      `🔊 البوت دخل روم 24/7: ${channel.name}`
    );

  } catch (error) {
    console.error(
      "❌ خطأ في اتصال 24/7:",
      error
    );

    voice247Connection = null;

    setTimeout(() => {
      connect247().catch(console.error);
    }, 10000);
  }
}

// ==================================================
// STORE COMMANDS
// ==================================================

const commands = [

  // STORE

  new SlashCommandBuilder()
    .setName("store")
    .setDescription("عرض متجر Soork Store"),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("إرسال لوحة المتجر")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("products")
    .setDescription("عرض المنتجات"),

  // PRODUCTS

  new SlashCommandBuilder()
    .setName("addproduct")
    .setDescription("إضافة منتج")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(o =>
      o.setName("name")
        .setDescription("اسم المنتج")
        .setRequired(true)
    )
    .addNumberOption(o =>
      o.setName("price")
        .setDescription("السعر")
        .setRequired(true)
        .setMinValue(0)
    )
    .addIntegerOption(o =>
      o.setName("stock")
        .setDescription("المخزون")
        .setRequired(true)
        .setMinValue(0)
    )
    .addStringOption(o =>
      o.setName("description")
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
      o.setName("id")
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
      o.setName("id")
        .setDescription("ID المنتج")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("name")
        .setDescription("الاسم الجديد")
        .setRequired(false)
    )
    .addNumberOption(o =>
      o.setName("price")
        .setDescription("السعر الجديد")
        .setRequired(false)
        .setMinValue(0)
    )
    .addIntegerOption(o =>
      o.setName("stock")
        .setDescription("المخزون الجديد")
        .setRequired(false)
        .setMinValue(0)
    )
    .addStringOption(o =>
      o.setName("description")
        .setDescription("الوصف الجديد")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("stock")
    .setDescription("عرض المخزون")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  // TICKET

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("إرسال لوحة التكت"),

  // MUSIC

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("تشغيل أغنية")
    .addStringOption(o =>
      o.setName("song")
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

  // 24/7

  new SlashCommandBuilder()
    .setName("247")
    .setDescription("إدخال البوت روم 24/7")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("247stop")
    .setDescription("إخراج البوت من روم 24/7")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

].map(command => command.toJSON());

// ==================================================
// STORE EMBED
// ==================================================

function storeEmbed() {
  return new EmbedBuilder()
    .setTitle(
      `🛒 ${env.STORE_NAME || "Soork Store"}`
    )
    .setDescription(
      "اختر المنتج من القائمة لفتح طلب خاص.\n\n" +
      "💳 بعد فتح الطلب ستظهر بيانات تحويل الراجحي.\n" +
      "📤 بعد التحويل ارفع إثبات الدفع.\n" +
      "✅ الإدارة تؤكد الدفع بعد مراجعة الإثبات."
    );
}

function productMenu() {
  const products = getProducts()
    .filter(p => Number(p.stock) > 0)
    .slice(0, 25);

  const menu = new StringSelectMenuBuilder()
    .setCustomId("select_product")
    .setPlaceholder("🛒 اختر المنتج");

  if (!products.length) {
    menu.addOptions({
      label: "لا توجد منتجات متوفرة",
      value: "none",
    });
  } else {
    menu.addOptions(
      products.map(product => ({
        label:
          `${product.name} - ${product.price} ريال`
            .slice(0, 100),

        description:
          String(
            product.description || "بدون وصف"
          ).slice(0, 100),

        value: product.id,
      }))
    );
  }

  return menu;
}

// ==================================================
// PAYMENT
// ==================================================

function paymentEmbed(product = null) {

  let description =
    `**البنك:** ${
      env.RAJHI_BANK_NAME ||
      "مصرف الراجحي"
    }\n\n` +

    `**اسم صاحب الحساب:** ${
      env.RAJHI_ACCOUNT_NAME ||
      "غير مضبوط"
    }\n\n` +

    `**الآيبان:** \`${
      env.RAJHI_IBAN ||
      "غير مضبوط"
    }\``;

  if (product) {
    description +=
      `\n\n**المبلغ:** **${product.price} ريال**`;
  }

  description +=
    "\n\n📤 بعد التحويل أرسل إثبات الدفع داخل التكت.";

  return new EmbedBuilder()
    .setTitle("💳 بيانات التحويل")
    .setDescription(description);
}

// ==================================================
// TICKET PANEL
// ==================================================

function ticketPanelEmbed() {
  return new EmbedBuilder()
    .setTitle(
      `🎫 ${env.STORE_NAME || "Soork Store"} | التذاكر`
    )
    .setDescription(
      "مرحبًا بك في نظام الدعم.\n\n" +

      "🛒 **تكت شراء**\n" +
      "لشراء منتج أو الاستفسار عن الطلبات.\n\n" +

      "📞 **تكت دعم فني**\n" +
      "للاستفسارات والمشاكل والدعم.\n\n" +

      "اضغط على الزر المناسب لفتح تكت خاص مع الإدارة.\n\n" +

      "━━━━━━━━━━━━━━━━━━━━\n\n" +

      "💳 **بيانات التحويل تظهر داخل التكت عند الحاجة.**"
    )
    .setFooter({
      text: "Soork Store • نظام التذاكر",
    });
}

function ticketPanelButtons() {

  return new ActionRowBuilder().addComponents(

    new ButtonBuilder()
      .setCustomId("create_purchase_ticket")
      .setLabel("تكت شراء")
      .setEmoji("🛒")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("create_support_ticket")
      .setLabel("تكت دعم فني")
      .setEmoji("📞")
      .setStyle(ButtonStyle.Primary)

  );
}

// ==================================================
// TICKET CONTROL BUTTONS
// ==================================================

function ticketControlButtons(claimed = false) {

  const claimButton =
    new ButtonBuilder()
      .setCustomId("claim_ticket")
      .setLabel(
        claimed
          ? "تم استلام التكت"
          : "استلام التكت"
      )
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Success)
      .setDisabled(claimed);

  return [

    new ActionRowBuilder().addComponents(
      claimButton,

      new ButtonBuilder()
        .setCustomId("rename_ticket")
        .setLabel("تغيير الاسم")
        .setEmoji("✏️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("add_ticket_member")
        .setLabel("إضافة عضو")
        .setEmoji("👤")
        .setStyle(ButtonStyle.Primary)
    ),

    new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId("ticket_payment")
        .setLabel("بيانات التحويل")
        .setEmoji("💳")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("إغلاق التكت")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("delete_ticket")
        .setLabel("حذف التكت")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Secondary)

    ),

  ];
}

// ==================================================
// CREATE TICKET
// ==================================================

async function createTicket(
  interaction,
  type
) {

  const existing = interaction.guild.channels.cache.find(
    channel =>
      channel.topic &&
      channel.topic.includes(
        `TICKET_OWNER:${interaction.user.id}`
      )
  );

  if (existing) {
    return interaction.reply({
      content:
        `🎫 عندك تكت مفتوح بالفعل: ${existing}`,
      ephemeral: true,
    });
  }

  const typeName =
    type === "purchase"
      ? "شراء"
      : "دعم";

  const channelName =
    `${type === "purchase" ? "purchase" : "support"}-${interaction.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 20);

  const overwrites = [

    {
      id:
        interaction.guild.roles.everyone.id,

      deny: [
        PermissionFlagsBits.ViewChannel,
      ],
    },

    {
      id: interaction.user.id,

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

      id: env.STAFF_ROLE_ID,

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
        channelName ||
        `ticket-${interaction.user.id}`,

      type:
        ChannelType.GuildText,

      parent:
        env.TICKET_CATEGORY_ID || null,

      topic:
        `TICKET_OWNER:${interaction.user.id} | TYPE:${type}`,

      permissionOverwrites:
        overwrites,

    });

  const ticketEmbed =
    new EmbedBuilder()
      .setTitle(
        type === "purchase"
          ? "🛒 تكت شراء"
          : "📞 تكت دعم فني"
      )
      .setDescription(

        `أهلًا <@${interaction.user.id}> 👋\n\n` +

        (
          type === "purchase"
            ? "اكتب المنتج الذي تريده وسيتم مساعدتك في إتمام الطلب."
            : "اكتب مشكلتك أو استفسارك وسيتم الرد عليك من الإدارة."
        ) +

        "\n\n" +

        "━━━━━━━━━━━━━━━━━━━━\n\n" +

        "🎫 **استلام التكت**\n" +
        "يمكن لأحد أعضاء الإدارة استلام التكت.\n\n" +

        "💳 **بيانات التحويل**\n" +
        "اضغط الزر لعرض بيانات الراجحي والآيبان.\n\n" +

        "🔒 **إغلاق التكت**\n" +
        "إغلاق التكت عند الانتهاء."

      )
      .setFooter({
        text:
          `نوع التكت: ${typeName} • لم يتم استلامه بعد`,
      });

  const message =
    await channel.send({

      content:
        `<@${interaction.user.id}>` +

        (
          env.STAFF_ROLE_ID
            ? ` <@&${env.STAFF_ROLE_ID}>`
            : ""
        ),

      embeds: [
        ticketEmbed,
      ],

      components:
        ticketControlButtons(false),

    });

  // منع حذف رسالة التكت الأصلية بالخطأ
  channel.ticketMessageId = message.id;

  return interaction.reply({

    content:
      `✅ تم إنشاء التكت: ${channel}`,

    ephemeral: true,

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
      new REST({
        version: "10",
      }).setToken(
        env.DISCORD_TOKEN
      );

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
      "✅ جميع الأوامر تسجلت بنجاح"
    );

  } catch (error) {

    console.error(
      "❌ خطأ تسجيل الأوامر:",
      error
    );

  }

  // دخول روم 24/7 تلقائيًا
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

        // ==================================================
        // STORE
        // ==================================================

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

          return interaction.reply({

            embeds: [
              storeEmbed(),
            ],

            components: [

              new ActionRowBuilder()
                .addComponents(
                  productMenu()
                ),

            ],

          });

        }

        // ==================================================
        // TICKET PANEL
        // ==================================================

        if (
          interaction.commandName === "ticket"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ هذا الأمر للإدارة فقط.",

              ephemeral: true,

            });

          }

          return interaction.reply({

            embeds: [
              ticketPanelEmbed(),
            ],

            components: [
              ticketPanelButtons(),
            ],

          });

        }

        // ==================================================
        // PRODUCTS
        // ==================================================

        if (
          interaction.commandName === "products"
        ) {

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
              .map(
                p =>
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

        // ==================================================
        // ADD PRODUCT
        // ==================================================

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
            ) ||
            "بدون وصف";

          const products =
            getProducts();

          const product = {

            id:
              Date.now().toString(36) +
              Math.random()
                .toString(36)
                .substring(2, 6),

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

        // ==================================================
        // REMOVE PRODUCT
        // ==================================================

        if (
          interaction.commandName === "removeproduct"
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

        // ==================================================
        // EDIT PRODUCT
        // ==================================================

        if (
          interaction.commandName === "editproduct"
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

        // ==================================================
        // STOCK
        // ==================================================

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
              .map(
                p =>
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

        // ==================================================
        // 24/7
        // ==================================================

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

          if (!env.VOICE_247_CHANNEL_ID) {

            return interaction.reply({

              content:
                "❌ ما حددت VOICE_247_CHANNEL_ID في Variables.",

              ephemeral: true,

            });

          }

          await connect247();

          return interaction.reply(
            "🔊 تم تشغيل نظام 24/7."
          );

        }

        if (
          interaction.commandName === "247stop"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ هذا الأمر للإدارة فقط.",

              ephemeral: true,

            });

          }

          if (voice247Connection) {

            try {
              voice247Connection.destroy();
            } catch {}

            voice247Connection = null;

          }

          return interaction.reply(
            "🔇 تم إخراج البوت من روم 24/7."
          );

        }

        // ==================================================
        // PLAY
        // ==================================================

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

                url:
                  search[0].url,

                title:
                  search[0].title,

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

        // ==================================================
        // SKIP
        // ==================================================

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
              "❌ ما فيه أغنية شغالة."
            );

          }

          queue.player.stop();

          return interaction.reply(
            "⏭️ تم تخطي الأغنية."
          );

        }

        // ==================================================
        // STOP
        // ==================================================

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

            try {
              queue.connection.destroy();
            } catch {}

            queue.connection = null;

          }

          queue.playing = false;

          return interaction.reply(
            "⏹️ تم إيقاف الموسيقى."
          );

        }

        // ==================================================
        // PAUSE
        // ==================================================

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
            "⏸️ تم إيقاف الأغنية مؤقتًا."
          );

        }

        // ==================================================
        // RESUME
        // ==================================================

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
            "▶️ تم استكمال الأغنية."
          );

        }

        // ==================================================
        // QUEUE
        // ==================================================

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
              "📭 قائمة الأغاني فارغة."
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
      // PRODUCT MENU
      // ==================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "select_product"
      ) {

        const productId =
          interaction.values[0];

        if (productId === "none") {

          return interaction.reply({

            content:
              "❌ لا توجد منتجات.",

            ephemeral: true,

          });

        }

        const products =
          getProducts();

        const product =
          products.find(
            p => p.id === productId
          );

        if (!product) {

          return interaction.reply({

            content:
              "❌ المنتج غير موجود.",

            ephemeral: true,

          });

        }

        if (
          Number(product.stock) <= 0
        ) {

          return interaction.reply({

            content:
              "❌ المنتج نفد من المخزون.",

            ephemeral: true,

          });

        }

        await interaction.deferReply({
          ephemeral: true,
        });

        const username =
          interaction.user.username
            .toLowerCase()
            .replace(
              /[^a-z0-9-_]/g,
              ""
            )
            .slice(0, 18) ||
          "customer";

        const channelName =
          `order-${username}-${Date.now()
            .toString()
            .slice(-4)}`;

        const overwrites = [

          {
            id:
              interaction.guild.roles
                .everyone.id,

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
              PermissionFlagsBits.ManageChannels,
            ],

          });

        }

        const channel =
          await interaction.guild.channels.create({

            name:
              channelName,

            type:
              ChannelType.GuildText,

            parent:
              env.ORDERS_CATEGORY_ID ||
              null,

            permissionOverwrites:
              overwrites,

          });

        const orderEmbed =
          new EmbedBuilder()

            .setTitle(
              "🧾 طلب جديد"
            )

            .setDescription(

              `**العميل:** <@${interaction.user.id}>\n` +
              `**المنتج:** ${product.name}\n` +
              `**السعر:** ${product.price} ريال\n` +
              `**المخزون:** ${product.stock}\n` +
              `**الحالة:** 🟡 بانتظار الدفع`

            );

        await channel.send({

          content:
            `<@${interaction.user.id}>` +

            (
              env.STAFF_ROLE_ID
                ? ` <@&${env.STAFF_ROLE_ID}>`
                : ""
            ),

          embeds: [
            orderEmbed,
            paymentEmbed(product),
          ],

          components: [

            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()
                  .setCustomId(
                    "approve_order"
                  )
                  .setLabel(
                    "تأكيد الدفع"
                  )
                  .setEmoji("✅")
                  .setStyle(
                    ButtonStyle.Success
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    "reject_order"
                  )
                  .setLabel(
                    "رفض الإثبات"
                  )
                  .setEmoji("❌")
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    "close_order"
                  )
                  .setLabel(
                    "إغلاق الطلب"
                  )
                  .setEmoji("🔒")
                  .setStyle(
                    ButtonStyle.Secondary
                  )

              ),

          ],

        });

        return interaction.editReply({

          content:
            `✅ تم إنشاء طلبك: ${channel}`,

        });

      }

      // ==================================================
      // BUTTONS
      // ==================================================

      if (interaction.isButton()) {

        // ==================================================
        // CREATE PURCHASE TICKET
        // ==================================================

        if (
          interaction.customId ===
          "create_purchase_ticket"
        ) {

          return createTicket(
            interaction,
            "purchase"
          );

        }

        // ==================================================
        // CREATE SUPPORT TICKET
        // ==================================================

        if (
          interaction.customId ===
          "create_support_ticket"
        ) {

          return createTicket(
            interaction,
            "support"
          );

        }

        // ==================================================
        // CLAIM TICKET
        // ==================================================

        if (
          interaction.customId ===
          "claim_ticket"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ استلام التكت للإدارة فقط.",

              ephemeral: true,

            });

          }

          const topic =
            interaction.channel.topic || "";

          if (
            topic.includes("CLAIMED_BY:")
          ) {

            return interaction.reply({

              content:
                "❌ هذا التكت مستلم من إداري آخر.",

              ephemeral: true,

            });

          }

          await interaction.channel.setTopic(
            `${topic} | CLAIMED_BY:${interaction.user.id}`
          );

          const messages =
            await interaction.channel.messages.fetch({
              limit: 20,
            });

          const ticketMessage =
            messages.find(
              m =>
                m.author.id ===
                  client.user.id &&
                m.components.length > 0
            );

          if (ticketMessage) {

            const embeds =
              ticketMessage.embeds;

            const oldEmbed =
              embeds[0];

            const newEmbed =
              EmbedBuilder.from(
                oldEmbed
              )
              .setFooter({

                text:
                  `تم استلام التكت بواسطة ${interaction.user.tag}`,

              });

            await ticketMessage.edit({

              embeds: [
                newEmbed,
              ],

              components:
                ticketControlButtons(true),

            });

          }

          return interaction.reply({

            content:
              `🎫 تم استلام التكت بواسطة <@${interaction.user.id}>.`,

          });

        }

        // ==================================================
        // RENAME TICKET
        // ==================================================

        if (
          interaction.customId ===
          "rename_ticket"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ تغيير اسم التكت للإدارة فقط.",

              ephemeral: true,

            });

          }

          const modal =
            new ModalBuilder()
              .setCustomId(
                "rename_ticket_modal"
              )
              .setTitle(
                "✏️ تغيير اسم التكت"
              );

          const input =
            new TextInputBuilder()
              .setCustomId(
                "new_ticket_name"
              )
              .setLabel(
                "اسم التكت الجديد"
              )
              .setPlaceholder(
                "مثال: طلب-امجد"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true)
              .setMaxLength(80);

          modal.addComponents(
            new ActionRowBuilder()
              .addComponents(input)
          );

          return interaction.showModal(
            modal
          );

        }

        // ==================================================
        // ADD MEMBER
        // ==================================================

        if (
          interaction.customId ===
          "add_ticket_member"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ إضافة عضو للإدارة فقط.",

              ephemeral: true,

            });

          }

          const modal =
            new ModalBuilder()
              .setCustomId(
                "add_ticket_member_modal"
              )
              .setTitle(
                "👤 إضافة عضو للتكت"
              );

          const input =
            new TextInputBuilder()
              .setCustomId(
                "member_id"
              )
              .setLabel(
                "ID العضو"
              )
              .setPlaceholder(
                "ضع Discord ID الخاص بالعضو"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder()
              .addComponents(input)
          );

          return interaction.showModal(
            modal
          );

        }

        // ==================================================
        // PAYMENT
        // ==================================================

        if (
          interaction.customId ===
          "ticket_payment"
        ) {

          return interaction.reply({

            embeds: [
              paymentEmbed(),
            ],

            ephemeral: true,

          });

        }

        // ==================================================
        // CLOSE TICKET
        // ==================================================

        if (
          interaction.customId ===
          "close_ticket"
        ) {

          if (
            !isStaff(interaction)
          ) {

            const topic =
              interaction.channel.topic ||
              "";

            const ownerMatch =
              topic.match(
                /TICKET_OWNER:(\d+)/
              );

            if (
              !ownerMatch ||
              ownerMatch[1] !==
                interaction.user.id
            ) {

              return interaction.reply({

                content:
                  "❌ فقط صاحب التكت أو الإدارة يستطيع إغلاقه.",

                ephemeral: true,

              });

            }

          }

          const confirmRow =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()
                  .setCustomId(
                    "confirm_close_ticket"
                  )
                  .setLabel(
                    "نعم، أغلق التكت"
                  )
                  .setEmoji("🔒")
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    "cancel_close_ticket"
                  )
                  .setLabel(
                    "إلغاء"
                  )
                  .setEmoji("↩️")
                  .setStyle(
                    ButtonStyle.Secondary
                  )

              );

          return interaction.reply({

            content:
              "⚠️ هل أنت متأكد من إغلاق التكت؟",

            components: [
              confirmRow,
            ],

          });

        }

        // ==================================================
        // CONFIRM CLOSE
        // ==================================================

        if (
          interaction.customId ===
          "confirm_close_ticket"
        ) {

          if (
            !isStaff(interaction)
          ) {

            const topic =
              interaction.channel.topic ||
              "";

            const ownerMatch =
              topic.match(
                /TICKET_OWNER:(\d+)/
              );

            if (
              !ownerMatch ||
              ownerMatch[1] !==
                interaction.user.id
            ) {

              return interaction.reply({

                content:
                  "❌ ما عندك صلاحية.",

                ephemeral: true,

              });

            }

          }

          await interaction.update({

            content:
              "🔒 سيتم إغلاق التكت خلال 5 ثوانٍ...",

            components: [],

          });

          setTimeout(() => {

            interaction.channel
              .delete()
              .catch(() => {});

          }, 5000);

          return;

        }

        // ==================================================
        // CANCEL CLOSE
        // ==================================================

        if (
          interaction.customId ===
          "cancel_close_ticket"
        ) {

          return interaction.update({

            content:
              "✅ تم إلغاء إغلاق التكت.",

            components: [],

          });

        }

        // ==================================================
        // DELETE TICKET
        // ==================================================

        if (
          interaction.customId ===
          "delete_ticket"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ حذف التكت للإدارة فقط.",

              ephemeral: true,

            });

          }

          await interaction.reply(
            "🗑️ سيتم حذف التكت خلال 3 ثوانٍ."
          );

          setTimeout(() => {

            interaction.channel
              .delete()
              .catch(() => {});

          }, 3000);

          return;

        }

        // ==================================================
        // ORDER APPROVE
        // ==================================================

        if (
          interaction.customId ===
          "approve_order"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ للإدارة فقط.",

              ephemeral: true,

            });

          }

          const messages =
            await interaction.channel.messages.fetch({
              limit: 20,
            });

          let productName = null;

          for (
            const [, message]
            of messages
          ) {

            for (
              const embed
              of message.embeds
            ) {

              if (
                embed.title ===
                  "🧾 طلب جديد" &&
                embed.description
              ) {

                const match =
                  embed.description.match(
                    /\*\*المنتج:\*\* (.+)/
                  );

                if (match) {

                  productName =
                    match[1].trim();

                }

              }

            }

          }

          if (!productName) {

            return interaction.reply({

              content:
                "❌ لم أستطع تحديد المنتج.",

              ephemeral: true,

            });

          }

          const products =
            getProducts();

          const product =
            products.find(
              p =>
                p.name ===
                productName
            );

          if (!product) {

            return interaction.reply({

              content:
                "❌ المنتج غير موجود.",

              ephemeral: true,

            });

          }

          if (
            Number(product.stock) <= 0
          ) {

            return interaction.reply({

              content:
                "❌ المخزون أصبح 0.",

              ephemeral: true,

            });

          }

          product.stock =
            Number(product.stock) - 1;

          saveProducts(products);

          await interaction.channel.send({

            embeds: [

              new EmbedBuilder()

                .setTitle(
                  "✅ تم تأكيد الدفع"
                )

                .setDescription(

                  `**المنتج:** ${product.name}\n` +
                  `**المبلغ:** ${product.price} ريال\n` +
                  `**تم بواسطة:** <@${interaction.user.id}>\n` +
                  `**المخزون المتبقي:** ${product.stock}`

                ),

            ],

          });

          return interaction.reply({

            content:
              "✅ تم تأكيد الدفع وخصم المنتج من المخزون.",

            ephemeral: true,

          });

        }

        // ==================================================
        // ORDER REJECT
        // ==================================================

        if (
          interaction.customId ===
          "reject_order"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ للإدارة فقط.",

              ephemeral: true,

            });

          }

          await interaction.channel.send({

            embeds: [

              new EmbedBuilder()

                .setTitle(
                  "❌ تم رفض إثبات الدفع"
                )

                .setDescription(
                  `تم الرفض بواسطة <@${interaction.user.id}>`
                ),

            ],

          });

          return interaction.reply({

            content:
              "❌ تم رفض الإثبات.",

            ephemeral: true,

          });

        }

        // ==================================================
        // CLOSE ORDER
        // ==================================================

        if (
          interaction.customId ===
          "close_order"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ للإدارة فقط.",

              ephemeral: true,

            });

          }

          await interaction.reply(
            "🔒 سيتم إغلاق الطلب خلال 5 ثوانٍ."
          );

          setTimeout(() => {

            interaction.channel
              .delete()
              .catch(() => {});

          }, 5000);

          return;

        }

      }

      // ==================================================
      // MODALS
      // ==================================================

      if (interaction.isModalSubmit()) {

        // ==================================================
        // RENAME
        // ==================================================

        if (
          interaction.customId ===
          "rename_ticket_modal"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ للإدارة فقط.",

              ephemeral: true,

            });

          }

          let newName =
            interaction.fields.getTextInputValue(
              "new_ticket_name"
            );

          newName =
            newName
              .toLowerCase()
              .replace(
                /[^a-z0-9-_أ-ي]/g,
                "-"
              )
              .replace(
                /-+/g,
                "-"
              )
              .slice(0, 90);

          if (!newName) {

            return interaction.reply({

              content:
                "❌ اسم التكت غير صالح.",

              ephemeral: true,

            });

          }

          await interaction.channel.setName(
            newName
          );

          return interaction.reply({

            content:
              `✅ تم تغيير اسم التكت إلى **${newName}**`,

          });

        }

        // ==================================================
        // ADD MEMBER
        // ==================================================

        if (
          interaction.customId ===
          "add_ticket_member_modal"
        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:
                "❌ للإدارة فقط.",

              ephemeral: true,

            });

          }

          let memberId =
            interaction.fields.getTextInputValue(
              "member_id"
            )
              .replace(/[<@!>]/g, "")
              .trim();

          const member =
            await interaction.guild.members
              .fetch(memberId)
              .catch(() => null);

          if (!member) {

            return interaction.reply({

              content:
                "❌ ما لقيت العضو. تأكد من الـ ID.",

              ephemeral: true,

            });

          }

          await interaction.channel.permissionOverwrites.edit(
            member.id,
            {

              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
              AttachFiles: true,

            }
          );

          return interaction.reply({

            content:
              `✅ تمت إضافة <@${member.id}> إلى التكت.`,

          });

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
// PROOF UPLOAD DETECTOR
// ==================================================

client.on(
  "messageCreate",
  async message => {

    if (message.author.bot)
      return;

    if (
      !message.channel ||
      !message.channel.name
    )
      return;

    if (
      !message.channel.name.startsWith(
        "order-"
      )
    )
      return;

    if (
      !message.attachments.size
    )
      return;

    const files =
      [
        ...message.attachments.values()
      ]
        .map(a => a.url)
        .join("\n");

    const embed =
      new EmbedBuilder()

        .setTitle(
          "📤 إثبات دفع جديد"
        )

        .setDescription(

          `**المرسل:** <@${message.author.id}>\n\n` +
          `تم إرسال إثبات دفع في الطلب.\n\n` +
          files

        )

        .setFooter({

          text:
            "راجع التحويل ثم اضغط تأكيد الدفع أو رفض الإثبات.",

        });

    if (env.STAFF_ROLE_ID) {

      await message.channel.send({

        content:
          `<@&${env.STAFF_ROLE_ID}>`,

        embeds: [
          embed,
        ],

      });

    } else {

      await message.channel.send({

        embeds: [
          embed,
        ],

      });

    }

  }
);

// ==================================================
// LOGIN
// ==================================================

client.login(
  env.DISCORD_TOKEN
);
