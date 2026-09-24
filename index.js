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

    return JSON.parse(

      fs.readFileSync(productsFile, "utf8")

    );

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

    Partials.User,

  ],

});

// ==================================================

// STAFF

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

        if (queue.songs.length) {

          const guild = client.guilds.cache.get(guildId);

          if (guild) {

            playNext(guild).catch(console.error);

          }

        } else {

          queue.playing = false;

        }

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

  } catch (error) {

    console.error("Music error:", error);

    queue.songs.shift();

    if (queue.songs.length) {

      await playNext(guild);

    } else {

      queue.playing = false;

    }

  }

}

// ==================================================

// STORE EMBED

// ==================================================

function storeEmbed() {

  return new EmbedBuilder()

    .setTitle(

      `🛒 ${env.STORE_NAME || "Soork Store"}`

    )

    .setDescription(

      "مرحبًا بك في متجرنا 👋\n\n" +

      "اختر المنتج من القائمة لفتح طلب شراء خاص.\n\n" +

      "💳 بعد فتح التكت ستظهر بيانات تحويل الراجحي.\n" +

      "📤 بعد التحويل ارفع إثبات الدفع.\n" +

      "✅ الإدارة تراجع الإثبات وتؤكد الدفع.\n\n" +

      "Soork Store"

    );

}

// ==================================================

// PRODUCT MENU

// ==================================================

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

function paymentEmbed(product) {

  return new EmbedBuilder()

    .setTitle("💳 بيانات التحويل")

    .setDescription(

      `**البنك:** ${

        env.RAJHI_BANK_NAME || "مصرف الراجحي"

      }\n\n` +

      `**اسم صاحب الحساب:** ${

        env.RAJHI_ACCOUNT_NAME || "غير مضبوط"

      }\n\n` +

      `**الآيبان:**\n` +

      `\`${env.RAJHI_IBAN || "غير مضبوط"}\`\n\n` +

      `**المبلغ:** ${product.price} ريال\n\n` +

      "📤 بعد التحويل ارفع صورة إثبات الدفع هنا.\n" +

      "⚠️ لا يتم اعتبار الطلب مدفوعًا حتى تؤكد الإدارة الدفع."

    );

}

// ==================================================

// MAIN TICKET PANEL

// ==================================================

function ticketPanel() {

  const embed = new EmbedBuilder()

    .setTitle("🎫 نظام التذاكر")

    .setDescription(

      "مرحبًا بك في نظام الدعم الخاص بنا 👋\n\n" +

      "🛒 **تكت شراء**\n" +

      "لشراء منتج أو الاستفسار عن الطلبات.\n\n" +

      "☎️ **تكت دعم فني**\n" +

      "للاستفسارات والمشاكل والدعم.\n\n" +

      "اضغط الزر المناسب بالأسفل لفتح تكت خاص مع الإدارة."

    )

    .setFooter({

      text: env.STORE_NAME || "Soork Store",

    });

  const row = new ActionRowBuilder()

    .addComponents(

      new ButtonBuilder()

        .setCustomId("ticket_purchase")

        .setLabel("تكت شراء")

        .setEmoji("🛒")

        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()

        .setCustomId("ticket_support")

        .setLabel("تكت دعم فني")

        .setEmoji("☎️")

        .setStyle(ButtonStyle.Primary)

    );

  return {

    embeds: [embed],

    components: [row],

  };

}

// ==================================================

// TICKET BUTTONS

// ==================================================

function purchaseTicketButtons() {

  return new ActionRowBuilder()

    .addComponents(

      new ButtonBuilder()

        .setCustomId("claim_ticket")

        .setLabel("استلام التكت")

        .setEmoji("🎫")

        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()

        .setCustomId("rename_ticket")

        .setLabel("تغيير الاسم")

        .setEmoji("✏️")

        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()

        .setCustomId("approve_payment")

        .setLabel("تأكيد الدفع")

        .setEmoji("💳")

        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()

        .setCustomId("reject_payment")

        .setLabel("رفض الإثبات")

        .setEmoji("❌")

        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()

        .setCustomId("close_ticket")

        .setLabel("إغلاق")

        .setEmoji("🔒")

        .setStyle(ButtonStyle.Secondary)

    );

}

function supportTicketButtons() {

  return new ActionRowBuilder()

    .addComponents(

      new ButtonBuilder()

        .setCustomId("claim_ticket")

        .setLabel("استلام التكت")

        .setEmoji("🎫")

        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()

        .setCustomId("rename_ticket")

        .setLabel("تغيير الاسم")

        .setEmoji("✏️")

        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()

        .setCustomId("close_ticket")

        .setLabel("إغلاق")

        .setEmoji("🔒")

        .setStyle(ButtonStyle.Danger)

    );

}

// ==================================================

// CREATE PURCHASE TICKET

// ==================================================

async function createPurchaseTicket(interaction) {

  const existing = interaction.guild.channels.cache.find(

    channel =>

      channel.topic &&

      channel.topic.includes(

        `USER:${interaction.user.id}`

      ) &&

      channel.topic.includes("TYPE:PURCHASE")

  );

  if (existing) {

    return interaction.reply({

      content:

        `🛒 عندك تكت شراء مفتوح بالفعل: ${existing}`,

      ephemeral: true,

    });

  }

  const products = getProducts()

    .filter(p => Number(p.stock) > 0)

    .slice(0, 25);

  if (!products.length) {

    return interaction.reply({

      content:

        "❌ لا توجد منتجات متوفرة حاليًا.",

      ephemeral: true,

    });

  }

  const menu = new StringSelectMenuBuilder()

    .setCustomId("purchase_product_select")

    .setPlaceholder("🛒 اختر المنتج");

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

  return interaction.reply({

    content:

      "🛒 اختر المنتج الذي تريد شراءه:",

    components: [

      new ActionRowBuilder().addComponents(menu),

    ],

    ephemeral: true,

  });

}

// ==================================================

// CREATE SUPPORT TICKET

// ==================================================

async function createSupportTicket(interaction) {

  const existing = interaction.guild.channels.cache.find(

    channel =>

      channel.topic &&

      channel.topic.includes(

        `USER:${interaction.user.id}`

      ) &&

      channel.topic.includes("TYPE:SUPPORT")

  );

  if (existing) {

    return interaction.reply({

      content:

        `☎️ عندك تكت دعم مفتوح بالفعل: ${existing}`,

      ephemeral: true,

    });

  }

  await interaction.deferReply({

    ephemeral: true,

  });

  const username =

    interaction.user.username

      .toLowerCase()

      .replace(/[^a-z0-9-_]/g, "")

      .slice(0, 18) ||

    "user";

  const channelName =

    `دعم-${username}`;

  const overwrites = [

    {

      id: interaction.guild.roles.everyone.id,

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

      name: channelName,

      type: ChannelType.GuildText,

      parent:

        env.TICKET_CATEGORY_ID || null,

      topic:

        `TYPE:SUPPORT | USER:${interaction.user.id}`,

      permissionOverwrites: overwrites,

    });

  const embed =

    new EmbedBuilder()

      .setTitle("☎️ تكت الدعم الفني")

      .setDescription(

        `أهلًا <@${interaction.user.id}> 👋\n\n` +

        "مرحبًا بك في الدعم الفني.\n" +

        "اكتب مشكلتك أو استفسارك هنا وسيتم الرد عليك من الإدارة.\n\n" +

        "🎫 اضغط **استلام التكت** إذا كنت من الإدارة وتريد استلام التكت.\n" +

        "✏️ يمكنك تغيير اسم التكت.\n" +

        "🔒 يمكنك إغلاق التكت بعد الانتهاء."

      )

      .setFooter({

        text:

          env.STORE_NAME ||

          "Soork Store",

      });

  await channel.send({

    content:

      `<@${interaction.user.id}>` +

      (

        env.STAFF_ROLE_ID

          ? ` <@&${env.STAFF_ROLE_ID}>`

          : ""

      ),

    embeds: [embed],

    components: [

      supportTicketButtons(),

    ],

  });

  return interaction.editReply({

    content:

      `✅ تم فتح تكت الدعم: ${channel}`,

  });

}

// ==================================================

// CREATE PURCHASE TICKET AFTER PRODUCT

// ==================================================

async function createPurchaseTicketWithProduct(

  interaction,

  product

) {

  if (!product) {

    return interaction.reply({

      content:

        "❌ المنتج غير موجود.",

      ephemeral: true,

    });

  }

  if (Number(product.stock) <= 0) {

    return interaction.reply({

      content:

        "❌ المنتج نفد من المخزون.",

      ephemeral: true,

    });

  }

  const existing = interaction.guild.channels.cache.find(

    channel =>

      channel.topic &&

      channel.topic.includes(

        `USER:${interaction.user.id}`

      ) &&

      channel.topic.includes("TYPE:PURCHASE")

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

  const username =

    interaction.user.username

      .toLowerCase()

      .replace(/[^a-z0-9-_]/g, "")

      .slice(0, 18) ||

    "user";

  const channelName =

    `شراء-${username}`;

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

      name: channelName,

      type: ChannelType.GuildText,

      parent:

        env.TICKET_CATEGORY_ID || null,

      topic:

        `TYPE:PURCHASE | USER:${interaction.user.id} | PRODUCT:${product.id}`,

      permissionOverwrites: overwrites,

    });

  const embed =

    new EmbedBuilder()

      .setTitle("🛒 تكت شراء")

      .setDescription(

        `أهلًا <@${interaction.user.id}> 👋\n\n` +

        `**المنتج:** ${product.name}\n` +

        `**السعر:** ${product.price} ريال\n` +

        `**المخزون الحالي:** ${product.stock}\n\n` +

        "💳 **بيانات التحويل**\n\n" +

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

        `💰 **المبلغ المطلوب:** ${product.price} ريال\n\n` +

        "📤 بعد التحويل ارفع صورة إثبات الدفع داخل التكت.\n\n" +

        "⚠️ لا ترسل أي إثبات دفع قبل إتمام التحويل.\n" +

        "⚠️ لا يتم اعتماد الطلب إلا بعد مراجعة الإدارة."

      )

      .setFooter({

        text:

          env.STORE_NAME ||

          "Soork Store",

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

      embed,

    ],

    components: [

      purchaseTicketButtons(),

    ],

  });

  return interaction.editReply({

    content:

      `✅ تم فتح تكت الشراء: ${channel}`,

  });

}

// ==================================================

// COMMANDS

// ==================================================

const commands = [

  new SlashCommandBuilder()

    .setName("setup")

    .setDescription("إرسال لوحة التذاكر")

    .setDefaultMemberPermissions(

      PermissionFlagsBits.ManageGuild

    ),

  new SlashCommandBuilder()

    .setName("store")

    .setDescription("عرض المتجر"),

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

        .setDescription("الوصف")

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

        .setDescription("الاسم")

        .setRequired(false)

    )

    .addNumberOption(o =>

      o.setName("price")

        .setDescription("السعر")

        .setRequired(false)

        .setMinValue(0)

    )

    .addIntegerOption(o =>

      o.setName("stock")

        .setDescription("المخزون")

        .setRequired(false)

        .setMinValue(0)

    )

    .addStringOption(o =>

      o.setName("description")

        .setDescription("الوصف")

        .setRequired(false)

    ),

  new SlashCommandBuilder()

    .setName("stock")

    .setDescription("عرض المخزون")

    .setDefaultMemberPermissions(

      PermissionFlagsBits.ManageGuild

    ),

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

    .setDescription("قائمة الأغاني"),

].map(c => c.toJSON());

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

      "✅ تم تسجيل الأوامر بنجاح"

    );

  } catch (error) {

    console.error(

      "❌ خطأ تسجيل الأوامر:",

      error

    );

  }

});

// ==================================================

// INTERACTIONS

// ==================================================

client.on(

  "interactionCreate",

  async interaction => {

    try {

      // ==========================================

      // SLASH COMMANDS

      // ==========================================

      if (interaction.isChatInputCommand()) {

        // ---------------- SETUP ----------------

        if (

          interaction.commandName === "setup"

        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:

                "❌ هذا الأمر للإدارة فقط.",

              ephemeral: true,

            });

          }

          return interaction.reply(

            ticketPanel()

          );

        }

        // ---------------- STORE ----------------

        if (

          interaction.commandName === "store"

        ) {

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

        // ---------------- PRODUCTS ----------------

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

            products.map(p =>

              `📦 **${p.name}**\n` +

              `🆔 \`${p.id}\`\n` +

              `💰 ${p.price} ريال\n` +

              `📊 المخزون: ${p.stock}\n` +

              `📝 ${p.description || "بدون وصف"}`

            ).join("\n\n");

          return interaction.reply({

            content:

              text.slice(0, 4000),

            ephemeral: true,

          });

        }

        // ---------------- ADD PRODUCT ----------------

        if (

          interaction.commandName ===

          "addproduct"

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

        // ---------------- REMOVE PRODUCT ----------------

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

        // ---------------- EDIT PRODUCT ----------------

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

        // ---------------- STOCK ----------------

        if (

          interaction.commandName ===

          "stock"

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

            products.map(p =>

              `📦 **${p.name}** — ${p.stock} قطعة\n` +

              `🆔 \`${p.id}\``

            ).join("\n\n");

          return interaction.reply({

            content:

              `📊 **مخزون المتجر**\n\n${text}`,

            ephemeral: true,

          });

        }

        // ---------------- MUSIC PLAY ----------------

        if (

          interaction.commandName ===

          "play"

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

                });

              queue.connection.subscribe(

                queue.player

              );

            }

            queue.songs.push(

              result

            );

            if (!queue.playing) {

              await playNext(

                interaction.guild

              );

            }

            return interaction.editReply(

              `🎵 تمت إضافة **${result.title}**`

            );

          } catch (error) {

            console.error(error);

            return interaction.editReply(

              "❌ حصل خطأ أثناء تشغيل الأغنية."

            );

          }

        }

        // ---------------- SKIP ----------------

        if (

          interaction.commandName ===

          "skip"

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

            "⏭️ تم تخطي الأغنية."

          );

        }

        // ---------------- STOP ----------------

        if (

          interaction.commandName ===

          "stop"

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

        // ---------------- PAUSE ----------------

        if (

          interaction.commandName ===

          "pause"

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

        // ---------------- RESUME ----------------

        if (

          interaction.commandName ===

          "resume"

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

        // ---------------- QUEUE ----------------

        if (

          interaction.commandName ===

          "queue"

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

      }

      // ==========================================

      // PRODUCT MENU

      // ==========================================

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

        if (Number(product.stock) <= 0) {

          return interaction.reply({

            content:

              "❌ المنتج نفد.",

            ephemeral: true,

          });

        }

        await createPurchaseTicketWithProduct(

          interaction,

          product

        );

        return;

      }

      // ==========================================

      // PURCHASE PRODUCT SELECT

      // ==========================================

      if (

        interaction.isStringSelectMenu() &&

        interaction.customId ===

          "purchase_product_select"

      ) {

        const productId =

          interaction.values[0];

        const products =

          getProducts();

        const product =

          products.find(

            p => p.id === productId

          );

        await createPurchaseTicketWithProduct(

          interaction,

          product

        );

        return;

      }

      // ==========================================

      // BUTTONS

      // ==========================================

      if (interaction.isButton()) {

        // ----------------------------------------

        // PURCHASE TICKET

        // ----------------------------------------

        if (

          interaction.customId ===

          "ticket_purchase"

        ) {

          return createPurchaseTicket(

            interaction

          );

        }

        // ----------------------------------------

        // SUPPORT TICKET

        // ----------------------------------------

        if (

          interaction.customId ===

          "ticket_support"

        ) {

          return createSupportTicket(

            interaction

          );

        }

        // ----------------------------------------

        // CLAIM

        // ----------------------------------------

        if (

          interaction.customId ===

          "claim_ticket"

        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:

                "❌ هذا الزر للإدارة فقط.",

              ephemeral: true,

            });

          }

          const channel =

            interaction.channel;

          if (!channel.topic) {

            return interaction.reply({

              content:

                "❌ هذا ليس تكت.",

              ephemeral: true,

            });

          }

          if (

            channel.topic.includes(

              "CLAIMED:"

            )

          ) {

            const match =

              channel.topic.match(

                /CLAIMED:(\d+)/

              );

            if (match) {

              return interaction.reply({

                content:

                  `❌ التكت مستلم بالفعل من <@${match[1]}>.`,

                ephemeral: true,

              });

            }

          }

          channel.setTopic(

            `${channel.topic} | CLAIMED:${interaction.user.id}`

          ).catch(() => {});

          await channel.send({

            embeds: [

              new EmbedBuilder()

                .setTitle("🎫 تم استلام التكت")

                .setDescription(

                  `تم استلام هذا التكت بواسطة <@${interaction.user.id}>.`

                ),

            ],

          });

          return interaction.reply({

            content:

              "✅ تم استلام التكت بنجاح.",

            ephemeral: true,

          });

        }

        // ----------------------------------------

        // RENAME

        // ----------------------------------------

        if (

          interaction.customId ===

          "rename_ticket"

        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:

                "❌ هذا الزر للإدارة فقط.",

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

                "اكتب اسم التكت الجديد"

              )

              .setPlaceholder(

                "مثال: شراء-امجد"

              )

              .setStyle(

                TextInputStyle.Short

              )

              .setRequired(true)

              .setMaxLength(90);

          modal.addComponents(

            new ActionRowBuilder()

              .addComponents(input)

          );

          return interaction.showModal(

            modal

          );

        }

        // ----------------------------------------

        // APPROVE PAYMENT

        // ----------------------------------------

        if (

          interaction.customId ===

          "approve_payment"

        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:

                "❌ هذا الزر للإدارة فقط.",

              ephemeral: true,

            });

          }

          const topic =

            interaction.channel.topic ||

            "";

          const match =

            topic.match(

              /PRODUCT:([a-z0-9]+)/

            );

          if (!match) {

            return interaction.reply({

              content:

                "❌ لم أستطع تحديد المنتج.",

              ephemeral: true,

            });

          }

          const productId =

            match[1];

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

        // ----------------------------------------

        // REJECT PAYMENT

        // ----------------------------------------

        if (

          interaction.customId ===

          "reject_payment"

        ) {

          if (!isStaff(interaction)) {

            return interaction.reply({

              content:

                "❌ هذا الزر للإدارة فقط.",

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

                  `تم رفض الإثبات بواسطة <@${interaction.user.id}>.`

                ),

            ],

          });

          return interaction.reply({

            content:

              "❌ تم رفض إثبات الدفع.",

            ephemeral: true,

          });

        }

        // ----------------------------------------

        // CLOSE TICKET

        // ----------------------------------------

        if (

          interaction.customId ===

          "close_ticket"

        ) {

          if (!isStaff(interaction)) {

            const topic =

              interaction.channel.topic ||

              "";

            const userMatch =

              topic.match(

                /USER:(\d+)/

              );

            if (

              !userMatch ||

              userMatch[1] !==

                interaction.user.id

            ) {

              return interaction.reply({

                content:

                  "❌ ما عندك صلاحية إغلاق هذا التكت.",

                ephemeral: true,

              });

            }

          }

          await interaction.reply(

            "🔒 سيتم إغلاق التكت خلال 5 ثوانٍ."

          );

          setTimeout(() => {

            interaction.channel

              .delete()

              .catch(() => {});

          }, 5000);

          return;

        }

      }

      // ==========================================

      // MODAL

      // ==========================================

      if (

        interaction.isModalSubmit() &&

        interaction.customId ===

          "rename_ticket_modal"

      ) {

        if (!isStaff(interaction)) {

          return interaction.reply({

            content:

              "❌ هذا للإدارة فقط.",

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

            .replace(/\s+/g, "-")

            .replace(

              /[^a-zA-Z0-9\u0600-\u06FF-_]/g,

              ""

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

          ephemeral: true,

        });

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

// PROOF DETECTOR

// ==================================================

client.on(

  "messageCreate",

  async message => {

    if (message.author.bot)

      return;

    const channel =

      message.channel;

    if (!channel.topic)

      return;

    if (

      !channel.topic.includes(

        "TYPE:PURCHASE"

      )

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

        .map(a => a.url)

        .join("\n");

    const embed =

      new EmbedBuilder()

        .setTitle(

          "📤 إثبات دفع جديد"

        )

        .setDescription(

          `**المرسل:** <@${message.author.id}>\n\n` +

          "تم إرسال إثبات دفع داخل تكت الشراء.\n\n" +

          files

        )

        .setFooter({

          text:

            "راجع التحويل ثم استخدم زر تأكيد الدفع أو رفض الإثبات.",

        });

    await channel.send({

      content:

        env.STAFF_ROLE_ID

          ? `<@&${env.STAFF_ROLE_ID}>`

          : undefined,

      embeds: [

        embed,

      ],

    });

  }

);

// ==================================================

// LOGIN

// ==================================================

client.login(

  env.DISCORD_TOKEN

);
