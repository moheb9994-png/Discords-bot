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
  console.error(
    "❌ ضع DISCORD_TOKEN و GUILD_ID في Railway Variables"
  );
  process.exit(1);
}

// ==================================================
// DATA
// ==================================================

const dataDir = path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, {
    recursive: true,
  });
}

// ---------------- PRODUCTS ----------------

const productsFile = path.join(
  dataDir,
  "products.json"
);

if (!fs.existsSync(productsFile)) {
  fs.writeFileSync(
    productsFile,
    "[]",
    "utf8"
  );
}

function getProducts() {
  try {
    return JSON.parse(
      fs.readFileSync(
        productsFile,
        "utf8"
      )
    );
  } catch {
    return [];
  }
}

function saveProducts(products) {
  fs.writeFileSync(
    productsFile,
    JSON.stringify(
      products,
      null,
      2
    ),
    "utf8"
  );
}

// ---------------- 24/7 ----------------

const voice247File = path.join(
  dataDir,
  "247.json"
);

if (!fs.existsSync(voice247File)) {
  fs.writeFileSync(
    voice247File,
    "{}",
    "utf8"
  );
}

function get247() {
  try {
    return JSON.parse(
      fs.readFileSync(
        voice247File,
        "utf8"
      )
    );
  } catch {
    return {};
  }
}

function save247(data) {
  fs.writeFileSync(
    voice247File,
    JSON.stringify(
      data,
      null,
      2
    ),
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
  ],
});

// ==================================================
// MUSIC
// ==================================================

const musicQueues = new Map();

function getQueue(guildId) {
  if (!musicQueues.has(guildId)) {
    musicQueues.set(guildId, {
      songs: [],

      player: createAudioPlayer({
        behaviors: {
          noSubscriber:
            NoSubscriberBehavior.Pause,
        },
      }),

      connection: null,
      playing: false,
      listenerAdded: false,
    });
  }

  return musicQueues.get(guildId);
}

async function playNext(guild) {
  const queue =
    getQueue(guild.id);

  if (!queue.songs.length) {
    queue.playing = false;
    return;
  }

  const song =
    queue.songs[0];

  try {
    const stream =
      await play.stream(
        song.url,
        {
          discordPlayerCompatibility:
            true,
        }
      );

    const resource =
      createAudioResource(
        stream.stream,
        {
          inputType:
            stream.type,
        }
      );

    queue.player.play(resource);

    queue.playing = true;

    stream.stream.on(
      "error",
      () => {

        queue.songs.shift();

        playNext(guild)
          .catch(console.error);

      }
    );

  } catch (error) {

    console.error(
      "Music error:",
      error
    );

    queue.songs.shift();

    if (queue.songs.length) {

      playNext(guild)
        .catch(console.error);

    } else {

      queue.playing = false;

    }

  }
}

// ==================================================
// 24/7 VOICE SYSTEM
// ==================================================

async function connect247(guild) {

  const data = get247();

  const channelId =
    data[guild.id];

  if (!channelId) {
    return false;
  }

  const channel =
    guild.channels.cache.get(
      channelId
    );

  if (
    !channel ||
    channel.type !==
      ChannelType.GuildVoice
  ) {

    console.log(
      `⚠️ روم 24/7 غير موجود في ${guild.name}`
    );

    return false;
  }

  try {

    const queue =
      getQueue(
        guild.id
      );

    if (
      queue.connection
    ) {

      try {
        queue.connection.destroy();
      } catch {}

      queue.connection =
        null;
    }

    const connection =
      joinVoiceChannel({

        channelId:
          channel.id,

        guildId:
          guild.id,

        adapterCreator:
          guild.voiceAdapterCreator,

        selfDeaf:
          true,

        selfMute:
          true,

      });

    queue.connection =
      connection;

    connection.on(
      "stateChange",
      (oldState, newState) => {

        if (
          newState.status ===
          "disconnected"
        ) {

          console.log(
            `🔄 محاولة إعادة الاتصال بـ ${channel.name}`
          );

          setTimeout(() => {

            connect247(
              guild
            ).catch(
              console.error
            );

          }, 5000);

        }

      }
    );

    console.log(
      `🔊 24/7 متصل في ${guild.name} / ${channel.name}`
    );

    return true;

  } catch (error) {

    console.error(
      "❌ خطأ 24/7:",
      error
    );

    return false;
  }
}

// ==================================================
// PERMISSIONS
// ==================================================

function isStaff(interaction) {

  if (!interaction.member) {
    return false;
  }

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
    interaction.member.roles.cache.has(
      env.STAFF_ROLE_ID
    )
  ) {

    return true;
  }

  return false;
}

// ==================================================
// COMMANDS
// ==================================================

const commands = [

  // ==================================================
  // STORE
  // ==================================================

  new SlashCommandBuilder()
    .setName("store")
    .setDescription(
      "عرض متجر Soork Store"
    ),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription(
      "إرسال لوحة المتجر"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("products")
    .setDescription(
      "عرض المنتجات"
    ),

  // ==================================================
  // PRODUCTS
  // ==================================================

  new SlashCommandBuilder()
    .setName("addproduct")
    .setDescription(
      "إضافة منتج"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )

    .addStringOption(o =>
      o
        .setName("name")
        .setDescription(
          "اسم المنتج"
        )
        .setRequired(true)
    )

    .addNumberOption(o =>
      o
        .setName("price")
        .setDescription(
          "السعر"
        )
        .setRequired(true)
        .setMinValue(0)
    )

    .addIntegerOption(o =>
      o
        .setName("stock")
        .setDescription(
          "المخزون"
        )
        .setRequired(true)
        .setMinValue(0)
    )

    .addStringOption(o =>
      o
        .setName("description")
        .setDescription(
          "وصف المنتج"
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("removeproduct")
    .setDescription(
      "حذف منتج"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )

    .addStringOption(o =>
      o
        .setName("id")
        .setDescription(
          "ID المنتج"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("editproduct")
    .setDescription(
      "تعديل منتج"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )

    .addStringOption(o =>
      o
        .setName("id")
        .setDescription(
          "ID المنتج"
        )
        .setRequired(true)
    )

    .addStringOption(o =>
      o
        .setName("name")
        .setDescription(
          "الاسم الجديد"
        )
        .setRequired(false)
    )

    .addNumberOption(o =>
      o
        .setName("price")
        .setDescription(
          "السعر الجديد"
        )
        .setRequired(false)
        .setMinValue(0)
    )

    .addIntegerOption(o =>
      o
        .setName("stock")
        .setDescription(
          "المخزون الجديد"
        )
        .setRequired(false)
        .setMinValue(0)
    )

    .addStringOption(o =>
      o
        .setName("description")
        .setDescription(
          "الوصف الجديد"
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("stock")
    .setDescription(
      "عرض المخزون"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  // ==================================================
  // TICKETS
  // ==================================================

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "فتح لوحة التذاكر"
    ),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription(
      "إغلاق التكت"
    ),

  // ==================================================
  // MODERATION
  // ==================================================

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription(
      "حظر عضو"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.BanMembers
    )

    .addUserOption(o =>
      o
        .setName("user")
        .setDescription(
          "العضو"
        )
        .setRequired(true)
    )

    .addStringOption(o =>
      o
        .setName("reason")
        .setDescription(
          "سبب الحظر"
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription(
      "طرد عضو"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.KickMembers
    )

    .addUserOption(o =>
      o
        .setName("user")
        .setDescription(
          "العضو"
        )
        .setRequired(true)
    )

    .addStringOption(o =>
      o
        .setName("reason")
        .setDescription(
          "سبب الطرد"
        )
        .setRequired(false)
    ),

  // ==================================================
  // MUSIC
  // ==================================================

  new SlashCommandBuilder()
    .setName("play")
    .setDescription(
      "تشغيل أغنية"
    )

    .addStringOption(o =>
      o
        .setName("song")
        .setDescription(
          "اسم الأغنية أو الرابط"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription(
      "تخطي الأغنية"
    ),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription(
      "إيقاف الموسيقى"
    ),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription(
      "إيقاف مؤقت"
    ),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription(
      "استكمال الأغنية"
    ),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription(
      "عرض قائمة الأغاني"
    ),

  // ==================================================
  // 24/7
  // ==================================================

  new SlashCommandBuilder()
    .setName("247")
    .setDescription(
      "إبقاء البوت في الروم الصوتي 24/7"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("247off")
    .setDescription(
      "إيقاف وضع 24/7"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

].map(command =>
  command.toJSON()
);

// ==================================================
// STORE EMBED
// ==================================================

function storeEmbed() {

  return new EmbedBuilder()

    .setTitle(
      `🛒 ${
        env.STORE_NAME ||
        "Soork Store"
      }`
    )

    .setDescription(

      "اختر المنتج من القائمة لفتح طلب خاص.\n\n" +

      "💳 بعد فتح الطلب ستظهر بيانات تحويل الراجحي.\n" +

      "📤 بعد التحويل ارفع إثبات الدفع.\n" +

      "✅ الإدارة تؤكد الدفع بعد مراجعة الإثبات."

    )

    .setFooter({
      text:
        "Soork Store",
    });
}

// ==================================================
// PRODUCT MENU
// ==================================================

function productMenu() {

  const products =
    getProducts()
      .filter(
        p =>
          Number(p.stock) > 0
      )
      .slice(0, 25);

  const menu =
    new StringSelectMenuBuilder()
      .setCustomId(
        "select_product"
      )
      .setPlaceholder(
        "🛒 اختر المنتج"
      );

  if (!products.length) {

    menu.addOptions({

      label:
        "لا توجد منتجات متوفرة",

      value:
        "none",

    });

  } else {

    menu.addOptions(

      products.map(
        product => ({

          label:
            `${product.name} - ${product.price} ريال`
              .slice(0, 100),

          description:
            String(
              product.description ||
              "بدون وصف"
            ).slice(0, 100),

          value:
            product.id,

        })
      )

    );

  }

  return menu;
}

// ==================================================
// PAYMENT
// ==================================================

function paymentEmbed(product) {

  return new EmbedBuilder()

    .setTitle(
      "💳 تحويل الراجحي"
    )

    .setDescription(

      `**البنك:** ${
        env.RAJHI_BANK_NAME ||
        "مصرف الراجحي"
      }\n` +

      `**اسم صاحب الحساب:** ${
        env.RAJHI_ACCOUNT_NAME ||
        "غير مضبوط"
      }\n` +

      `**الآيبان:** \`${
        env.RAJHI_IBAN ||
        "غير مضبوط"
      }\`\n` +

      `**المبلغ:** **${product.price} ريال**\n\n` +

      "📤 بعد التحويل ارفع صورة إثبات الدفع داخل الطلب.\n\n" +

      "⚠️ لا يتم اعتبار الطلب مدفوعًا حتى يتم تأكيده من الإدارة."

    );
}

// ==================================================
// ORDER BUTTONS
// ==================================================

function orderButtons() {

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          "proof"
        )
        .setLabel(
          "إرسال إثبات الدفع"
        )
        .setEmoji("📤")
        .setStyle(
          ButtonStyle.Primary
        ),

      new ButtonBuilder()
        .setCustomId(
          "approve"
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
          "reject"
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

    );
}

// ==================================================
// TICKET BUTTON
// ==================================================

function ticketButton() {

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          "open_ticket"
        )
        .setLabel(
          "فتح تكت"
        )
        .setEmoji("🎫")
        .setStyle(
          ButtonStyle.Primary
        )

    );
}

// ==================================================
// CLOSE TICKET BUTTON
// ==================================================

function closeTicketButton() {

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          "close_ticket"
        )
        .setLabel(
          "إغلاق التكت"
        )
        .setEmoji("🔒")
        .setStyle(
          ButtonStyle.Danger
        )

    );
}

// ==================================================
// READY
// ==================================================

client.once(
  "ready",
  async () => {

    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    try {

      const rest =
        new REST({
          version: "10",
        })
        .setToken(
          env.DISCORD_TOKEN
        );

      await rest.put(

        Routes.applicationGuildCommands(
          client.user.id,
          env.GUILD_ID
        ),

        {
          body:
            commands,
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

    // ==================================================
    // RESTORE 24/7
    // ==================================================

    try {

      const data =
        get247();

      const guild =
        client.guilds.cache.get(
          env.GUILD_ID
        );

      if (
        guild &&
        data[guild.id]
      ) {

        console.log(
          "🔄 استعادة اتصال 24/7..."
        );

        setTimeout(() => {

          connect247(
            guild
          ).catch(
            console.error
          );

        }, 3000);

      }

    } catch (error) {

      console.error(
        "❌ خطأ استعادة 24/7:",
        error
      );

    }

  }
);

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

      if (
        interaction.isChatInputCommand()
      ) {

        // ==================================================
        // STORE
        // ==================================================

        if (
          interaction.commandName ===
            "store" ||

          interaction.commandName ===
            "setup"
        ) {

          if (
            interaction.commandName ===
              "setup" &&

            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ هذا الأمر للإدارة فقط.",

              ephemeral:
                true,

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
        // PRODUCTS
        // ==================================================

        if (
          interaction.commandName ===
          "products"
        ) {

          const products =
            getProducts();

          if (!products.length) {

            return interaction.reply({

              content:
                "📦 لا توجد منتجات.",

              ephemeral:
                true,

            });

          }

          const text =
            products.map(
              p =>

                `📦 **${p.name}**\n` +

                `🆔 \`${p.id}\`\n` +

                `💰 ${p.price} ريال\n` +

                `📊 المخزون: ${p.stock}\n` +

                `📝 ${
                  p.description ||
                  "بدون وصف"
                }`

            ).join(
              "\n\n"
            );

          return interaction.reply({

            content:
              text.slice(
                0,
                4000
              ),

            ephemeral:
              true,

          });

        }

        // ==================================================
        // ADD PRODUCT
        // ==================================================

        if (
          interaction.commandName ===
          "addproduct"
        ) {

          if (
            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ للإدارة فقط.",

              ephemeral:
                true,

            });

          }

          const name =
            interaction.options
              .getString(
                "name"
              );

          const price =
            interaction.options
              .getNumber(
                "price"
              );

          const stock =
            interaction.options
              .getInteger(
                "stock"
              );

          const description =
            interaction.options
              .getString(
                "description"
              ) ||
            "بدون وصف";

          const products =
            getProducts();

          const product = {

            id:
              Date.now()
                .toString(36) +

              Math.random()
                .toString(36)
                .substring(
                  2,
                  6
                ),

            name:
              name,

            price:
              price,

            stock:
              stock,

            description:
              description,

          };

          products.push(
            product
          );

          saveProducts(
            products
          );

          return interaction.reply({

            content:

              `✅ تم إضافة المنتج\n\n` +

              `📦 ${name}\n` +

              `💰 ${price} ريال\n` +

              `📊 ${stock}\n` +

              `🆔 \`${product.id}\``,

            ephemeral:
              true,

          });

        }

        // ==================================================
        // REMOVE PRODUCT
        // ==================================================

        if (
          interaction.commandName ===
          "removeproduct"
        ) {

          if (
            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ للإدارة فقط.",

              ephemeral:
                true,

            });

          }

          const id =
            interaction.options
              .getString(
                "id"
              );

          const products =
            getProducts();

          const index =
            products.findIndex(
              p =>
                p.id === id
            );

          if (
            index === -1
          ) {

            return interaction.reply({

              content:
                "❌ المنتج غير موجود.",

              ephemeral:
                true,

            });

          }

          const removed =
            products.splice(
              index,
              1
            )[0];

          saveProducts(
            products
          );

          return interaction.reply({

            content:
              `🗑️ تم حذف **${removed.name}**`,

            ephemeral:
              true,

          });

        }

        // ==================================================
        // EDIT PRODUCT
        // ==================================================

        if (
          interaction.commandName ===
          "editproduct"
        ) {

          if (
            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ للإدارة فقط.",

              ephemeral:
                true,

            });

          }

          const id =
            interaction.options
              .getString(
                "id"
              );

          const products =
            getProducts();

          const product =
            products.find(
              p =>
                p.id === id
            );

          if (!product) {

            return interaction.reply({

              content:
                "❌ المنتج غير موجود.",

              ephemeral:
                true,

            });

          }

          const name =
            interaction.options
              .getString(
                "name"
              );

          const price =
            interaction.options
              .getNumber(
                "price"
              );

          const stock =
            interaction.options
              .getInteger(
                "stock"
              );

          const description =
            interaction.options
              .getString(
                "description"
              );

          if (
            name !== null
          ) {

            product.name =
              name;

          }

          if (
            price !== null
          ) {

            product.price =
              price;

          }

          if (
            stock !== null
          ) {

            product.stock =
              stock;

          }

          if (
            description !== null
          ) {

            product.description =
              description;

          }

          saveProducts(
            products
          );

          return interaction.reply({

            content:

              `✅ تم تعديل المنتج\n\n` +

              `📦 ${product.name}\n` +

              `💰 ${product.price} ريال\n` +

              `📊 ${product.stock}`,

            ephemeral:
              true,

          });

        }

        // ==================================================
        // STOCK
        // ==================================================

        if (
          interaction.commandName ===
          "stock"
        ) {

          if (
            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ للإدارة فقط.",

              ephemeral:
                true,

            });

          }

          const products =
            getProducts();

          if (!products.length) {

            return interaction.reply({

              content:
                "📦 لا توجد منتجات.",

              ephemeral:
                true,

            });

          }

          const text =
            products.map(
              p =>

                `📦 **${p.name}** — ${p.stock} قطعة\n` +

                `🆔 \`${p.id}\``

            ).join(
              "\n\n"
            );

          return interaction.reply({

            content:
              `📊 **مخزون المتجر**\n\n${text}`,

            ephemeral:
              true,

          });

        }

        // ==================================================
        // TICKET
        // ==================================================

        if (
          interaction.commandName ===
          "ticket"
        ) {

          return interaction.reply({

            embeds: [

              new EmbedBuilder()

                .setTitle(
                  "🎫 الدعم الفني"
                )

                .setDescription(
                  "اضغط الزر لفتح تكت خاص مع الإدارة."
                ),

            ],

            components: [
              ticketButton(),
            ],

          });

        }

        // ==================================================
        // CLOSE TICKET
        // ==================================================

        if (
          interaction.commandName ===
          "close"
        ) {

          if (
            !interaction.channel ||
            !interaction.channel.name ||
            !interaction.channel.name.startsWith(
              "ticket-"
            )
          ) {

            return interaction.reply({

              content:
                "❌ هذا الأمر يستخدم داخل التكت فقط.",

              ephemeral:
                true,

            });

          }

          const ticketOwnerId =
            interaction.channel.name
              .replace(
                "ticket-",
                ""
              );

          const isOwner =
            interaction.user.id ===
            ticketOwnerId;

          const staff =
            isStaff(
              interaction
            );

          if (
            !isOwner &&
            !staff
          ) {

            return interaction.reply({

              content:
                "❌ ما تقدر تقفل هذا التكت.",

              ephemeral:
                true,

            });

          }

          await interaction.reply(
            "🔒 سيتم إغلاق التكت خلال 5 ثوانٍ."
          );

          setTimeout(() => {

            if (
              interaction.channel &&
              interaction.channel.deletable
            ) {

              interaction.channel
                .delete()
                .catch(
                  () => {}
                );

            }

          }, 5000);

          return;

        }

        // ==================================================
        // BAN
        // ==================================================

        if (
          interaction.commandName ===
          "ban"
        ) {

          if (
            !interaction.member.permissions.has(
              PermissionFlagsBits.BanMembers
            )
          ) {

            return interaction.reply({

              content:
                "❌ ما عندك صلاحية الحظر.",

              ephemeral:
                true,

            });

          }

          const user =
            interaction.options
              .getUser(
                "user"
              );

          const reason =
            interaction.options
              .getString(
                "reason"
              ) ||
            "بدون سبب";

          try {

            await interaction.guild.members.ban(

              user.id,

              {
                reason:
                  reason,
              }

            );

            return interaction.reply(
              `🔨 تم حظر **${user.tag}**\nالسبب: ${reason}`
            );

          } catch {

            return interaction.reply({

              content:
                "❌ ما قدرت أحظر العضو. تأكد من ترتيب الرتب والصلاحيات.",

              ephemeral:
                true,

            });

          }

        }

        // ==================================================
        // KICK
        // ==================================================

        if (
          interaction.commandName ===
          "kick"
        ) {

          if (
            !interaction.member.permissions.has(
              PermissionFlagsBits.KickMembers
            )
          ) {

            return interaction.reply({

              content:
                "❌ ما عندك صلاحية الطرد.",

              ephemeral:
                true,

            });

          }

          const user =
            interaction.options
              .getUser(
                "user"
              );

          const reason =
            interaction.options
              .getString(
                "reason"
              ) ||
            "بدون سبب";

          const member =
            await interaction.guild.members
              .fetch(
                user.id
              )
              .catch(
                () => null
              );

          if (!member) {

            return interaction.reply({

              content:
                "❌ العضو غير موجود في السيرفر.",

              ephemeral:
                true,

            });

          }

          try {

            await member.kick(
              reason
            );

            return interaction.reply(
              `👢 تم طرد **${user.tag}**\nالسبب: ${reason}`
            );

          } catch {

            return interaction.reply({

              content:
                "❌ ما قدرت أطرد العضو.",

              ephemeral:
                true,

            });

          }

        }

        // ==================================================
        // PLAY
        // ==================================================

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

              ephemeral:
                true,

            });

          }

          const query =
            interaction.options
              .getString(
                "song"
              );

          await interaction.deferReply();

          try {

            let result;

            if (
              play.yt_validate(
                query
              ) === "video"
            ) {

              result = {

                url:
                  query,

                title:
                  "YouTube",

              };

            } else {

              const search =
                await play.search(
                  query,
                  {
                    limit:
                      1,

                    source: {
                      youtube:
                        "video",
                    },
                  }
                );

              if (
                !search.length
              ) {

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

            if (
              !queue.connection
            ) {

              queue.connection =
                joinVoiceChannel({

                  channelId:
                    voiceChannel.id,

                  guildId:
                    interaction.guild.id,

                  adapterCreator:
                    interaction.guild
                      .voiceAdapterCreator,

                  selfDeaf:
                    true,

                  selfMute:
                    true,

                });

              queue.connection.subscribe(
                queue.player
              );

              if (
                !queue.listenerAdded
              ) {

                queue.listenerAdded =
                  true;

                queue.player.on(
                  AudioPlayerStatus.Idle,
                  () => {

                    if (
                      queue.songs.length
                    ) {

                      queue.songs.shift();

                    }

                    if (
                      queue.songs.length
                    ) {

                      playNext(
                        interaction.guild
                      )
                      .catch(
                        console.error
                      );

                    } else {

                      queue.playing =
                        false;

                    }

                  }
                );

              }

            }

            queue.songs.push(
              result
            );

            if (
              !queue.playing
            ) {

              await playNext(
                interaction.guild
              );

            }

            return interaction.editReply(
              `🎵 تمت إضافة **${result.title}** إلى القائمة.`
            );

          } catch (error) {

            console.error(
              error
            );

            return interaction.editReply(
              "❌ حصل خطأ أثناء تشغيل الأغنية."
            );

          }

        }

        // ==================================================
        // SKIP
        // ==================================================

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

          queue.songs =
            [];

          queue.player.stop();

          if (
            queue.connection
          ) {

            queue.connection.destroy();

            queue.connection =
              null;

          }

          queue.playing =
            false;

          return interaction.reply(
            "⏹️ تم إيقاف الموسيقى."
          );

        }

        // ==================================================
        // PAUSE
        // ==================================================

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

        // ==================================================
        // RESUME
        // ==================================================

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

        // ==================================================
        // QUEUE
        // ==================================================

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
              "📭 قائمة الأغاني فارغة."
            );

          }

          const text =
            queue.songs
              .map(
                (
                  song,
                  index
                ) =>
                  `${index + 1}. ${song.title}`
              )
              .join(
                "\n"
              );

          return interaction.reply(
            `🎵 **قائمة الأغاني**\n\n${text}`
          );

        }

        // ==================================================
        // 247
        // ==================================================

        if (
          interaction.commandName ===
          "247"
        ) {

          if (
            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ هذا الأمر للإدارة فقط.",

              ephemeral:
                true,

            });

          }

          const voiceChannel =
            interaction.member.voice.channel;

          if (!voiceChannel) {

            return interaction.reply({

              content:
                "❌ ادخل الروم الصوتي أولاً.",

              ephemeral:
                true,

            });

          }

          if (
            voiceChannel.type !==
            ChannelType.GuildVoice
          ) {

            return interaction.reply({

              content:
                "❌ هذا ليس روم صوتي.",

              ephemeral:
                true,

            });

          }

          const data =
            get247();

          data[
            interaction.guild.id
          ] =
            voiceChannel.id;

          save247(
            data
          );

          const connected =
            await connect247(
              interaction.guild
            );

          if (!connected) {

            return interaction.reply({

              content:
                "❌ ما قدرت أدخل الروم الصوتي.",

              ephemeral:
                true,

            });

          }

          return interaction.reply({

            content:

              `🔊 تم تشغيل وضع **24/7**.\n\n` +

              `📍 الروم: **${voiceChannel.name}**\n` +

              `♾️ سيبقى البوت في الروم حتى تستخدم \`/247off\`.`,

            ephemeral:
              true,

          });

        }

        // ==================================================
        // 247 OFF
        // ==================================================

        if (
          interaction.commandName ===
          "247off"
        ) {

          if (
            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ هذا الأمر للإدارة فقط.",

              ephemeral:
                true,

            });

          }

          const data =
            get247();

          delete data[
            interaction.guild.id
          ];

          save247(
            data
          );

          const queue =
            musicQueues.get(
              interaction.guild.id
            );

          if (
            queue &&
            queue.connection
          ) {

            try {

              queue.connection.destroy();

            } catch {}

            queue.connection =
              null;

          }

          return interaction.reply({

            content:
              "🔇 تم إيقاف وضع **24/7** وإخراج البوت من الروم.",

            ephemeral:
              true,

          });

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

        if (
          productId ===
          "none"
        ) {

          return interaction.reply({

            content:
              "❌ لا توجد منتجات.",

            ephemeral:
              true,

          });

        }

        const products =
          getProducts();

        const product =
          products.find(
            p =>
              p.id ===
              productId
          );

        if (!product) {

          return interaction.reply({

            content:
              "❌ المنتج غير موجود.",

            ephemeral:
              true,

          });

        }

        if (
          Number(product.stock) <=
          0
        ) {

          return interaction.reply({

            content:
              "❌ المنتج نفد من المخزون.",

            ephemeral:
              true,

          });

        }

        await interaction.deferReply({
          ephemeral:
            true,
        });

        const username =
          interaction.user.username
            .toLowerCase()
            .replace(
              /[^a-z0-9-_]/g,
              ""
            )
            .slice(
              0,
              18
            ) ||
          "customer";

        const channelName =
          `order-${username}-${Date.now()
            .toString()
            .slice(
              -4
            )}`;

        const overwrites = [

          {
            id:
              interaction.guild
                .roles.everyone.id,

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

        if (
          env.STAFF_ROLE_ID
        ) {

          overwrites.push({

            id:
              env.STAFF_ROLE_ID,

            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.AttachFiles,
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
            paymentEmbed(
              product
            ),
          ],

          components: [
            orderButtons(),
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

      if (
        interaction.isButton()
      ) {

        // ==================================================
        // PROOF
        // ==================================================

        if (
          interaction.customId ===
          "proof"
        ) {

          return interaction.reply({

            content:

              "📤 ارفع صورة أو ملف إثبات التحويل في هذه القناة.\n\n" +

              "بعد رفع الإثبات انتظر الإدارة لمراجعته.",

            ephemeral:
              true,

          });

        }

        // ==================================================
        // APPROVE
        // ==================================================

        if (
          interaction.customId ===
          "approve"
        ) {

          if (
            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ زر تأكيد الدفع للإدارة فقط.",

              ephemeral:
                true,

            });

          }

          const messages =
            await interaction.channel.messages.fetch({

              limit:
                20,

            });

          let productName =
            null;

          for (
            const [
              ,
              message
            ] of messages
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

                if (
                  match
                ) {

                  productName =
                    match[1].trim();

                }

              }

            }

          }

          if (
            !productName
          ) {

            return interaction.reply({

              content:
                "❌ لم أستطع تحديد المنتج.",

              ephemeral:
                true,

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

              ephemeral:
                true,

            });

          }

          if (
            Number(product.stock) <=
            0
          ) {

            return interaction.reply({

              content:
                "❌ المخزون أصبح 0.",

              ephemeral:
                true,

            });

          }

          product.stock =
            Number(
              product.stock
            ) - 1;

          saveProducts(
            products
          );

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

            ephemeral:
              true,

          });

        }

        // ==================================================
        // REJECT
        // ==================================================

        if (
          interaction.customId ===
          "reject"
        ) {

          if (
            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ هذا الزر للإدارة فقط.",

              ephemeral:
                true,

            });

          }

          await interaction.channel.send({

            embeds: [

              new EmbedBuilder()

                .setTitle(
                  "❌ تم رفض إثبات الدفع"
                )

                .setDescription(
                  `تم رفض الإثبات بواسطة <@${interaction.user.id}>`
                ),

            ],

          });

          return interaction.reply({

            content:
              "❌ تم رفض الإثبات.",

            ephemeral:
              true,

          });

        }

        // ==================================================
        // CLOSE ORDER
        // ==================================================

        if (
          interaction.customId ===
          "close_order"
        ) {

          if (
            !isStaff(
              interaction
            )
          ) {

            return interaction.reply({

              content:
                "❌ إغلاق طلبات المتجر متاح للإدارة فقط.",

              ephemeral:
                true,

            });

          }

          await interaction.reply(
            "🔒 سيتم إغلاق الطلب خلال 5 ثوانٍ."
          );

          setTimeout(() => {

            if (
              interaction.channel &&
              interaction.channel.deletable
            ) {

              interaction.channel
                .delete()
                .catch(
                  () => {}
                );

            }

          }, 5000);

          return;

        }

        // ==================================================
        // OPEN TICKET
        // ==================================================

        if (
          interaction.customId ===
          "open_ticket"
        ) {

          const existing =
            interaction.guild.channels.cache.find(
              channel =>
                channel.name ===
                `ticket-${interaction.user.id}`
            );

          if (existing) {

            return interaction.reply({

              content:
                `🎫 عندك تكت مفتوح بالفعل: ${existing}`,

              ephemeral:
                true,

            });

          }

          const overwrites = [

            {
              id:
                interaction.guild
                  .roles.everyone.id,

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

          if (
            env.STAFF_ROLE_ID
          ) {

            overwrites.push({

              id:
                env.STAFF_ROLE_ID,

              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.AttachFiles,
              ],

            });

          }

          const channel =
            await interaction.guild.channels.create({

              name:
                `ticket-${interaction.user.id}`,

              type:
                ChannelType.GuildText,

              parent:
                env.TICKET_CATEGORY_ID ||
                null,

              permissionOverwrites:
                overwrites,

            });

          const embed =
            new EmbedBuilder()

              .setTitle(
                "🎫 تكت الدعم"
              )

              .setDescription(

                `أهلًا <@${interaction.user.id}> 👋\n\n` +

                "اكتب مشكلتك هنا وسيتم الرد عليك من الإدارة.\n\n" +

                "🔒 عند الانتهاء اضغط زر **إغلاق التكت**."

              )

              .setFooter({

                text:
                  "Soork Store • Support",

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
              closeTicketButton(),
            ],

          });

          return interaction.reply({

            content:
              `✅ تم إنشاء التكت بنجاح: ${channel}`,

            ephemeral:
              true,

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
            !interaction.channel ||
            !interaction.channel.name ||
            !interaction.channel.name.startsWith(
              "ticket-"
            )
          ) {

            return interaction.reply({

              content:
                "❌ هذا الزر يستخدم داخل التكت فقط.",

              ephemeral:
                true,

            });

          }

          const ticketOwnerId =
            interaction.channel.name
              .replace(
                "ticket-",
                ""
              );

          const isOwner =
            interaction.user.id ===
            ticketOwnerId;

          const staff =
            isStaff(
              interaction
            );

          if (
            !isOwner &&
            !staff
          ) {

            return interaction.reply({

              content:
                "❌ ما تقدر تقفل هذا التكت.",

              ephemeral:
                true,

            });

          }

          await interaction.reply({

            content:

              `🔒 تم طلب إغلاق التكت بواسطة <@${interaction.user.id}>.\n` +

              "سيتم حذف التكت خلال **5 ثوانٍ**.",

          });

          setTimeout(() => {

            if (
              interaction.channel &&
              interaction.channel.deletable
            ) {

              interaction.channel
                .delete()
                .catch(
                  () => {}
                );

            }

          }, 5000);

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

          ephemeral:
            true,

        }).catch(
          () => {}
        );

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

    if (
      message.author.bot
    ) {
      return;
    }

    if (
      !message.channel.name ||
      !message.channel.name.startsWith(
        "order-"
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
      [
        ...message.attachments.values()
      ]
        .map(
          a =>
            a.url
        )
        .join("\n");

    const embed =
      new EmbedBuilder()

        .setTitle(
          "📤 إثبات دفع جديد"
        )

        .setDescription(

          `**المرسل:** <@${message.author.id}>\n\n` +

          "تم إرسال إثبات دفع في الطلب.\n\n" +

          files

        )

        .setFooter({

          text:
            "راجع التحويل ثم اضغط تأكيد الدفع أو رفض الإثبات.",

        });

    if (
      env.STAFF_ROLE_ID
    ) {

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
