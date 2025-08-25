require('dotenv').config();
const { Client, ChannelType, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { VM } = require('vm2');
const cors = require('cors');
const cheerio = require("cheerio");
const readline = require('readline');
const axios = require('axios');
const ticketCooldowns = new Map(); // Guarda cooldowns por ID de usuario
const cooldownTime = 60 * 1000; // 60 segundos
const app = express();
const port = 3000;

const configex = require('./configex.json');

const CHANNEL_ID = configex.CHANNEL_ID;
const SERVEO_PORT = configex.SERVEO_PORT || 3301;
const SSH_CMD = configex.SSH_CMD || 'ssh';

app.use(cors());
app.use(express.json());

process.on('uncaughtException', (err) => {
    console.log(`Error: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.log(`Error: ${reason}`);
});

/* ====== CONFIG Y CLIENTE ====== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

let config = {
  prefix: 'CJ!',
  adminRoles: [],
  logsChannel: '',
  warns: {},
  mutes: {},
  userMemory: {},
  iapersonalizadi: {}, 
  iaChannelId: null,
  afkUsers: {},
  antispam: {
    enabled: false,
    roleIgnores: []
  },
  confessionChannelId: null
};



function saveDB() {
  fs.writeFileSync('database.json', JSON.stringify(config, null, 2));
}
function loadDB() {
  if (fs.existsSync('database.json')) {
    config = JSON.parse(fs.readFileSync('database.json', 'utf8'));
  }
}
loadDB();

const economia = require('./economia'); // Ajusta la ruta si es distinta
economia.registerEconomyCommands(client, config, saveDB, isAdmin);

// Asegurar directorio y archivos de datos
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json');

const PAGES_DIR = path.join(DATA_DIR, 'pages');
if (!fs.existsSync(PAGES_DIR)) fs.mkdirSync(PAGES_DIR);

/* ====== UTILIDADES ====== */
function readJsonSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch (e) {
    console.error('Error leyendo JSON', filePath, e);
    return fallback;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeJsonSafe(filePath, obj) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('Error escribiendo JSON', filePath, e);
  }
}

let commandsStore = readJsonSafe(COMMANDS_FILE, {});

function addAdminPermissions(channel, adminRoleIds) {
    for (const adminRoleId of adminRoleIds) {
        try {
            channel.permissionOverwrites.edit(adminRoleId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                ManageChannels: true //Permiso para cerrar el canal
            });
        } catch (error) {
            console.error(`Error al dar permisos al rol ${adminRoleId}:`, error);
        }
    }
}
// Verifica si el autor tiene permisos (owner o rol admin configurado)
function isAdmin(msg) {
  if (msg.member.id === msg.guild.ownerId) return true;
  return msg.member.roles.cache.some(role => config.adminRoles.includes(role.id));
}

// Establece el id al warnear a cada warn
function generateId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for(let i = 0; i < length; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Envía embed al canal de logs configurado si existe
function logEmbed(guild, embed) {
  if (!config.logsChannel) return;
  const ch = guild.channels.cache.get(config.logsChannel);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

// Convierte string tipo "5m", "10s", "2h" a ms
function msToMs(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return 0;
  const num = parseInt(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * multipliers[unit];
}

// ================== SISTEMA DE LOGS ==================
function sendLog(guild, embed) {
  const channelId = config.logsChannel;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (channel) channel.send({ embeds: [embed] }).catch(() => {});
}

// ==== Entradas / Salidas ====
client.on('guildMemberAdd', member => {
  sendLog(member.guild, new EmbedBuilder()
    .setColor('Green')
    .setTitle('📥 Nuevo miembro')
    .setDescription(`${member.user.tag} (${member.id}) se unió al servidor.`)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp());
});

client.on('guildMemberRemove', member => {
  sendLog(member.guild, new EmbedBuilder()
    .setColor('Red')
    .setTitle('📤 Miembro salió')
    .setDescription(`${member.user.tag} (${member.id}) salió o fue expulsado.`)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp());
});

// ==== Mensajes ====
client.on('messageDelete', msg => {
  if (!msg.guild || msg.author?.bot) return;
  sendLog(msg.guild, new EmbedBuilder()
    .setColor('Orange')
    .setTitle('🗑️ Mensaje eliminado')
    .addFields(
      { name: 'Autor', value: `${msg.author.tag} (${msg.author.id})` },
      { name: 'Canal', value: `${msg.channel}` },
      { name: 'Contenido', value: msg.content || '*[sin texto]*' }
    )
    .setTimestamp());
});

client.on('messageUpdate', (oldMsg, newMsg) => {
  if (!oldMsg.guild || oldMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;
  sendLog(oldMsg.guild, new EmbedBuilder()
    .setColor('Yellow')
    .setTitle('✏️ Mensaje editado')
    .addFields(
      { name: 'Autor', value: `${oldMsg.author.tag} (${oldMsg.author.id})` },
      { name: 'Canal', value: `${oldMsg.channel}` },
      { name: 'Antes', value: oldMsg.content || '*[vacío]*' },
      { name: 'Después', value: newMsg.content || '*[vacío]*' }
    )
    .setTimestamp());
});

// ==== Baneos ====
client.on('guildBanAdd', ban => {
  sendLog(ban.guild, new EmbedBuilder()
    .setColor('DarkRed')
    .setTitle('⛔ Usuario baneado')
    .setDescription(`${ban.user.tag} (${ban.user.id}) fue baneado.`)
    .setThumbnail(ban.user.displayAvatarURL())
    .setTimestamp());
});

client.on('guildBanRemove', ban => {
  sendLog(ban.guild, new EmbedBuilder()
    .setColor('Blue')
    .setTitle('✅ Usuario desbaneado')
    .setDescription(`${ban.user.tag} (${ban.user.id}) fue desbaneado.`)
    .setThumbnail(ban.user.displayAvatarURL())
    .setTimestamp());
});

// ==== Logs de comandos ADMIN (warn, mute, kick, antispam) ====
// Llamas a estas funciones dentro de tus comandos cuando apliques sanciones

function logWarn(guild, target, moderator, reason) {
  sendLog(guild, new EmbedBuilder()
    .setColor('Orange')
    .setTitle('⚠️ Usuario advertido')
    .setDescription(`${target.tag} (${target.id}) fue advertido.`)
    .addFields(
      { name: 'Moderador', value: `${moderator.tag} (${moderator.id})` },
      { name: 'Razón', value: reason || 'No especificada' }
    )
    .setThumbnail(target.displayAvatarURL())
    .setTimestamp());
}

function logMute(guild, target, moderator, duration, reason) {
  sendLog(guild, new EmbedBuilder()
    .setColor('Grey')
    .setTitle('🔇 Usuario muteado')
    .setDescription(`${target.tag} (${target.id}) fue muteado.`)
    .addFields(
      { name: 'Moderador', value: `${moderator.tag} (${moderator.id})` },
      { name: 'Duración', value: duration || 'Indefinido' },
      { name: 'Razón', value: reason || 'No especificada' }
    )
    .setThumbnail(target.displayAvatarURL())
    .setTimestamp());
}

function logKick(guild, target, moderator, reason) {
  sendLog(guild, new EmbedBuilder()
    .setColor('Red')
    .setTitle('👢 Usuario expulsado')
    .setDescription(`${target.tag} (${target.id}) fue expulsado.`)
    .addFields(
      { name: 'Moderador', value: `${moderator.tag} (${moderator.id})` },
      { name: 'Razón', value: reason || 'No especificada' }
    )
    .setThumbnail(target.displayAvatarURL())
    .setTimestamp());
}

function logAntispam(guild, target, message) {
  sendLog(guild, new EmbedBuilder()
    .setColor('DarkOrange')
    .setTitle('🚫 Mensaje bloqueado por Antispam')
    .setDescription(`${target.tag} (${target.id}) intentó enviar un link bloqueado.`)
    .addFields(
      { name: 'Mensaje', value: message.content || '[sin texto]' },
      { name: 'Canal', value: `${message.channel}` }
    )
    .setThumbnail(target.displayAvatarURL())
    .setTimestamp());
}
/* ====== COMANDOS ====== */

const commands = {


/* --- COMANDO HELP --- */
help: async (msg) => {
  // Embed de moderación y utilidades
  const embedModeracion = new EmbedBuilder()
    .setTitle('📖 Comandos de Moderación y Utilidad')
    .setColor('#0099ff')
    .setDescription(`
**Warn:** \`${config.prefix}warn @usuario [razón]\`  
⚠️ Advierte a un usuario por una razón específica.

**UnWarn:** \`${config.prefix}unwarn [id]\`  
❌ Elimina una advertencia usando su ID.

**Mute:** \`${config.prefix}mute @usuario [tiempo] [razón]\`  
🔇 Silencia a un usuario por un tiempo con motivo.

**UnMute:** \`${config.prefix}unmute @usuario\`  
🔊 Quita el silencio a un usuario.

**Ban:** \`${config.prefix}ban @usuario [razón]\`  
🚫 Expulsa a un usuario del servidor.

**UnBan:** \`${config.prefix}unban [id]\`  
♻️ Revoca un baneo usando su ID.

**List:** \`${config.prefix}list @usuario\`  
📋 Muestra las sanciones de un usuario.

**SetLogs:** \`${config.prefix}setlogs [canal_id]\`  
📝 Define el canal para registrar logs.

**RolAdmin:** \`${config.prefix}roladmin [rol_id]\`  
👑 Agrega un rol con permisos de administración del bot.

**RolRemoveAdmin:** \`${config.prefix}rolremoveadmin [rol_id]\`
👑 Remueve un rol de la lista de administradores del bot.

**Prefix:** \`${config.prefix}prefix [nuevo]\`  
⚙️ Cambia el prefijo del bot.

**Tickets:** \`${config.prefix}ticketspanel\`
📑 Se mostrará el menú de tickets.

**Forget:** \`${config.prefix}forget [#canal]\`
🧠 Borra la memoria del bot en un canal específico, permitiéndole interactuar de nuevo.

**Message:** \`${config.prefix}message [mensaje] [#canal]\`
💬 Envía un mensaje en un canal de texto específico.
  `);

  // Embed de diversión
  const embedDiversion = new EmbedBuilder()
    .setTitle('🎉 Comandos de Diversión')
    .setColor('#00ff99')
    .setDescription(`
**Cat:** \`${config.prefix}cat\`
😺 Muestra una imagen o GIF de un gato aleatorio.

**Pat:** \`${config.prefix}pat @usuario\`  
🤗 Da una caricia a otro usuario.

**Slap:** \`${config.prefix}slap @usuario\`  
👋 Da una bofetada juguetona.

**Hug:** \`${config.prefix}hug @usuario\`  
❤️ Abraza a un usuario.

**Kiss:** \`${config.prefix}kiss @usuario\`  
😘 Da un beso a otro usuario.

**Bye:** \`${config.prefix}bye\`  
Despídete de todos. 😉

**Bonk:** \`${config.prefix}bonk @usuario\`  
🔨 Da un golpecito divertido.

**Punch:** \`${config.prefix}punch @usuario\`  
🤕 Dale un golpe a alguien.

**Bang:** \`${config.prefix}bang @usuario\`  
🫡 **BANG!**.

**Cry:** \`${config.prefix}cry\`  
😭 Llora dramáticamente sin necesidad de mencionar a nadie.

**Die:** \`${config.prefix}die\`  
☠️ Dramáticamente muere virtualmente.

**Hi:** \`${config.prefix}hi @usuario o sin argumentos\`  
👋 Saluda a un usuario en concreto, o a todos si no se menciona a nadie.

**Sorteo:** \`${config.prefix}sorteo "Mensaje" Duración "Premio" NúmeroDeGanadores\`
🎉 Inicia un sorteo con mensaje, duración, premio y cantidad de ganadores.

**8ball:** \`${config.prefix}8ball [pregunta]\`
🎱 Haz una pregunta para que la bola 8 te dé una respuesta.

**Roll:** \`${config.prefix}roll [número]\`
🎲 Tira un dado con un número máximo especificado.

**Guess:** \`${config.prefix}guess\`
😼 Adivina en que numero estoy pensando

**rps:** \`${config.prefix}rps [@Usuario] o [piedra, papel o tigera]\`
✌️🫱✊️Juega piedra papel o tigera contra mi o contra un usuario.

**Probable:** \`${config.prefix}probable [pregunta]\`
🗣 Haz una pregunta y ve que usuario es mas probable.

**Confesion:** \`${config.prefix}confesion [confesion]\`
😳 Confiesa (Se ejecuta en el md del bot).

  `);

  // Embed de IA personalizada
  const embedIA = new EmbedBuilder()
    .setTitle('🤖 Comandos de IA Personalizada')
    .setColor('#7289DA')
    .setDescription(`
**CreateIA:** \`${config.prefix}createia [nombre]\`
✨ Crea una IA con un nombre único y la configura paso a paso con prompt, temperatura y más.

**IA:** \`${config.prefix}ia [mensaje]\`  
🤖 Habla con la inteligencia artificial integrada.

**setiachannel:** \`${config.prefix}setiachannel [#canal]\`
🤖 Establece el canal donde la IA hablará.

**iachat:** \`${config.prefix}iachat [nombre]\`
💬 Interactúa con una IA personalizada que has creado. Debe responder a un mensaje para continuar la conversación.
  `);
  
   const embedTecnico = new EmbedBuilder()
    .setTitle('🤖 Comandos Tecnicos')
    .setColor('#00ff99')
    .setDescription(`
**CreateF:** \`${config.prefix}createf [Codigo] [Nombre]\`
⚒️ Crea tus propios comandos. En [Codigo] pegas el codigo de la funcion del comando, en palabras cortas su comportamiento, En [Nombre] colocas el nombre para identificar el comando y poder usarlo en "${config.prefix}".

**WebC:** \`${config.prefix}webc [Codigo en HTML] [SubDominio]\`
📄 Crea tus propias paginas Subdominicas usando este comando, cuando acabes pones al final del server de serveo "/Tu Subdominio" ejemplo "${currentServeoUrl}/Caca"

Aclaraciones: Tambien puedes usar archivos adjuntos .html pero debes especificar el campo del codigo en vacio osea
||\`${config.prefix}webc "" "Ejemplo"|| asi se usa para archivos adjuntos

**Listf:** \`${config.prefix}listf\`
📚 Ver todos los comandos creados

**Removef:** \`${config.prefix}removef [Nombre]\`
📤 Elimina un comando

**Eval:** \`${config.prefix}eval [Prompt]\`
🖥 Ejecuta codigo en javascript (Sin guardar)

**Randomimg:** \`${config.prefix}randomimg\`
👀 +800 imagenes seleccionadas por floppa (No indexeado)
   `);

  // Botones para cambiar embed
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('moderacion')
      .setLabel('Moderación')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true), // Embed mostrado inicialmente
    new ButtonBuilder()
      .setCustomId('diversion')
      .setLabel('Diversión')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(false),
    new ButtonBuilder()
      .setCustomId('ia')
      .setLabel('IA Personalizada')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(false),
    new ButtonBuilder()
      .setCustomId('tecnico')
      .setLabel('Tecnica')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(false)
  );

  // Enviar embed inicial con botones
  const helpMessage = await msg.channel.send({ embeds: [embedModeracion], components: [row] });

  // Collector para los botones
  const collector = helpMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000 // 1 minuto para responder
  });

  collector.on('collect', async interaction => {
    if (interaction.user.id !== msg.author.id) {
      return interaction.reply({ content: 'Solo quien pidió el comando puede usar estos botones.', ephemeral: true });
    }

    const customId = interaction.customId;
    let embedToShow;

    if (customId === 'moderacion') {
      embedToShow = embedModeracion;
    } else if (customId === 'diversion') {
      embedToShow = embedDiversion;
    } else if (customId === 'ia') {
      embedToShow = embedIA;
    } else if (customId === 'tecnico') {
      embedToShow = embedTecnico;
    }

    const newRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('moderacion')
        .setLabel('Moderación')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(customId === 'moderacion'),
      new ButtonBuilder()
        .setCustomId('diversion')
        .setLabel('Diversión')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(customId === 'diversion'),
      new ButtonBuilder()
        .setCustomId('ia')
        .setLabel('IA Personalizada')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(customId === 'ia'),
      new ButtonBuilder()
        .setCustomId('tecnico')
        .setLabel('Tecnica')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(customId === 'tecnico')
    );

    await interaction.update({ embeds: [embedToShow], components: [newRow] });
  });

  collector.on('end', () => {
    helpMessage.edit({
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('moderacion')
            .setLabel('Moderación')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId('diversion')
            .setLabel('Diversión')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId('ia')
            .setLabel('IA Personalizada')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId('tecnico')
            .setLabel('Tecnica')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        )
      ]
    });
  });
},

ticketspanel: async (msg) => {
  if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');

  let category = msg.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === 'Tickets');
  if (!category) {
    try {
      category = await msg.guild.channels.create({
        name: 'Tickets',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: msg.guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
        ],
      });
    } catch (error) {
      console.error("Error al crear la categoría de tickets:", error);
      return msg.reply("❌ Error al crear la categoría de tickets. Contacta al administrador.");
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('『🌟』꧁ 𝐂𝐞𝐧𝐭𝐫𝐨 𝐝𝐞 𝗦𝗼𝗽𝗼𝗿𝘁𝗲 〜 𝗚𝗮𝘁𝗶𝘁𝗼𝘀 𝗨𝗻𝗶𝘁𝘆 𝗨𝗻𝗶𝘃𝗲𝗿𝘀𝗮𝗹 ꧂『🌟』')
    .setDescription(`
╔══════════════════════════╗  
║      🐾 𝗔𝗯𝗿𝗲 𝘂𝗻 𝘁𝗶𝗰𝗸𝗲𝘁 🐾                                     ║  
╚══════════════════════════╝  

─── ･ ｡ﾟ☆: *.☾🐈☽ .* :☆ﾟ. ────

- ➳ **¿Necesitas ayuda? Abre un ticket,y nuestro equipo te atenderá por favor hágalo con responsabilidad y elige las opciones.**

🌟 Opciones disponibles: 🌟
- 『🐱』 **reporte** – Problemas con usuarios o dudas generales.  
- 『💌』 **alianza** – Consultas o conflictos relacionados con alianzas.  
- 『📝』 **postulación** – Aplica para roles como @Helper, @mod,@admin, etc.  
- 『🎁』 **reclamo** – Reclama premios o recompensas ganadas.  
- 『❓』 **otro** – Para cualquier otro asunto no listado.

𖤐 **Reglas para abrir tickets:** 𖤐 
- ➳ No abuses abriendo tickets repetidos.  
- ➳ Evita falsos reportes o spam. (Sanción de warn, etc) 
- ➳ Mantén el respeto en todo momento. Si quieres ayuda, ten Encuentra eso, **__No aceptamos falta de respeto hacia el Staff__**

✡ **¿Quieres ser staff?** ✡ 
- ➳ Tener al menos 1/2 semana en el servidor.  
- ➳ Ser activo y/o responsable.  
- ➳ Conocer al menos las bases de las Reglas,son como cualquier otras.

───☾☀︎☽ ───

꧁ Únete a nuestro servidor de soporte si quieres hacer apelación de bans,etc:  [Discord Invitación](https://discord.gg/BnPqpbQBHq) ꧂

─── ･ ｡ﾟ☆: *.☾☕︎︎☽ .* :☆ﾟ. ───`)
    .setColor('Green')
    .setFooter({ text: 'Sistema de Tickets de Discord' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_reporte').setLabel('Reporte').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_alianza').setLabel('Alianza').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_postulacion').setLabel('Postulación').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_reclamo').setLabel('Reclamo').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_otro').setLabel('Otro').setStyle(ButtonStyle.Secondary),
  );

  await msg.channel.send({ embeds: [embed], components: [row] });
},

antispam: async (msg, args) => {
  if (!isAdmin(msg)) return msg.reply('❌ No tienes permisos para usar este comando.');
  if (!args[0]) return msg.reply(`Uso: \`${config.prefix}antispam on/off [--roleignore "IDROL1" "IDROL2"...]\``);

  const option = args[0].toLowerCase();

  if (option === 'on') {
    config.antispam.enabled = true;

    // Resetear lista de roles ignorados por si se vuelve a configurar
    config.antispam.roleIgnores = [];

    // Buscar exclusiones de roles
    const roleIgnoreIndex = args.indexOf('--roleignore');
    if (roleIgnoreIndex !== -1) {
      const roleIds = args.slice(roleIgnoreIndex + 1).map(r => r.replace(/"/g, ''));
      for (const roleId of roleIds) {
        if (roleId && !config.antispam.roleIgnores.includes(roleId)) {
          config.antispam.roleIgnores.push(roleId);
        }
      }
    }

    saveDB();
    return msg.reply(
      `✅ Antispam activado. Roles excluidos: ${config.antispam.roleIgnores.length > 0 
        ? config.antispam.roleIgnores.map(r => `<@&${r}>`).join(', ') 
        : 'ninguno (se aplica a todos)'}`
    );
  }

  if (option === 'off') {
    config.antispam.enabled = false;
    saveDB();
    return msg.reply(`❌ Antispam desactivado.`);
  }

  return msg.reply(`Uso: \`${config.prefix}antispam on/off [--roleignore "IDROL1" "IDROL2"...]\``);
},

/* --- COMANDO SETIACHANNEL --- */
setiachannel: async (msg, args) => {
  if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');
  const channelMention = args[0];
  if (!channelMention || !channelMention.startsWith('<#') || !channelMention.endsWith('>')) {
    return msg.reply('Por favor menciona el canal usando `#canal`, no pongas el ID.');
  }

  const channelId = channelMention.slice(2, -1);
  const channel = msg.guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) return msg.reply('Ese canal no es válido o no es de texto.');

  config.iaChannelId = channelId;
  saveDB();
  msg.reply(`Canal de IA establecido: <#${channelId}>`);
},

/* --- COMANDO WARN --- */
  warn: async (msg, args) => {
  if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');
  const member = msg.mentions.members.first();
  if (!member) return msg.reply('Menciona al usuario para warnearlo.');

  const reason = args.slice(1).join(' ') || 'Sin razón.';
  const uid = member.id;

  if (!config.warns[uid]) config.warns[uid] = [];

  // Generamos ID único y verificamos que no exista (aunque la probabilidad es muy baja)
  let warnId;
  do {
    warnId = generateId();
  } while (config.warns[uid].some(w => w.id === warnId));

  const warnData = {
    id: warnId,
    by: msg.author.id,
    reason,
    timestamp: Date.now()
  };

  config.warns[uid].push(warnData);
  saveDB();
  logWarn(msg.guild, member.user, msg.author, reason);
  
  const embed = new EmbedBuilder()
    .setColor('Red')
    .setTitle(`⚠️ ¡Fuiste warneado en ${msg.guild.name}!`)
    .setDescription(`Razón: ${reason}\nID de warn: \`${warnId}\`\nTus warns totales: ${config.warns[uid].length}`);

  try {
    await member.send({ embeds: [embed] });
  } catch (error) {
    console.log(`No se pudo enviar MD a ${member.user.tag}:`, error);
    await msg.channel.send(`${member.user}, no pude enviarte un mensaje privado.`);
  }

  await msg.reply(`Usuario ${member.user.tag} warneado. ID de warn: \`${warnId}\``);

  const log = new EmbedBuilder()
    .setTitle('Usuario warneado')
    .setColor('Red')
    .setDescription(`Usuario: ${member.user.tag} (${member.id})\nRazón: ${reason}\nID de warn: \`${warnId}\`\nPor: ${msg.author.tag}`);
  logEmbed(msg.guild, log);
},

/* --- COMANDO UNWARN --- */
  unwarn: async (msg, args) => {
  if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');
  const warnId = args[0];
  if (!warnId) return msg.reply('Debes especificar el ID del warn.');

  let found = false;
  for (const [uid, warns] of Object.entries(config.warns)) {
    const index = warns.findIndex(w => w.id === warnId);
    if (index !== -1) {
      warns.splice(index, 1);
      if (warns.length === 0) delete config.warns[uid];
      saveDB();
      found = true;
      await msg.reply(`Warn con ID \`${warnId}\` eliminado.`);
      break;
    }
  }
  if (!found) msg.reply('No se encontró ese ID de warn.');
},

/* --- COMANDO MUTE --- */
  mute: async (msg, args) => {
    if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');
    let member = msg.mentions.members.first(); 

if (!member) {
  const id = args[0]; // primer argumento después del comando
  try {
    member = await msg.guild.members.fetch(id); 
  } catch (e) {
    return msg.reply('No encontré al usuario. Usa mención o ID válido.');
  }
}
    const time = args[1];
    if (!time) return msg.reply('Debes especificar el tiempo (ejemplo: 5m, 10s, 1h).');
    const reason = args.slice(2).join(' ') || 'Sin razón.';

    let mutedRole = msg.guild.roles.cache.find(r => r.name === 'Muted');
    if (!mutedRole) {
      try {
        mutedRole = await msg.guild.roles.create({
          name: 'Muted',
          permissions: [],
          reason: 'Rol mutado creado por bot'
        });
        for (const [, channel] of msg.guild.channels.cache) {
          await channel.permissionOverwrites.edit(mutedRole, {
            SendMessages: false,
            AddReactions: false,
            Speak: false
          });
        }
      } catch (e) {
        return msg.reply('Error al crear el rol Muted.');
      }
    }

    await member.roles.add(mutedRole);

    config.mutes[member.id] = { until: Date.now() + msToMs(time), reason };
    saveDB();
    logMute(msg.guild, member.user, msg.author, time, reason);

    const embed = new EmbedBuilder()
      .setColor('Orange')
      .setTitle(`🔇 Has sido muteado en ${msg.guild.name}`)
      .setDescription(`Duración: ${time}\nRazón: ${reason}`);

    try {
      await member.send({ embeds: [embed] });
    } catch {
      await msg.channel.send(`${member.user}, no pude enviarte un mensaje privado.`);
    }

    await msg.reply(`${member.user.tag} ha sido muteado por ${time}.`);

    const log = new EmbedBuilder()
      .setTitle('Usuario muteado')
      .setColor('Orange')
      .setDescription(`Usuario: ${member.user.tag} (${member.id})\nDuración: ${time}\nRazón: ${reason}\nPor: ${msg.author.tag}`);
    logEmbed(msg.guild, log);
  },

/* --- COMANDO UNMUTE --- */
  unmute: async (msg, args) => {
    if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');
    let member = msg.mentions.members.first(); 

if (!member) {
  const id = args[0]; // primer argumento después del comando
  try {
    member = await msg.guild.members.fetch(id); 
  } catch (e) {
    return msg.reply('No encontré al usuario. Usa mención o ID válido.');
  }
}

    const mutedRole = msg.guild.roles.cache.find(r => r.name === 'Muted');
    if (mutedRole && member.roles.cache.has(mutedRole.id)) {
      await member.roles.remove(mutedRole);
    }
    delete config.mutes[member.id];
    saveDB();

    await msg.reply(`${member.user.tag} ha sido desmuteado.`);

    const log = new EmbedBuilder()
      .setTitle('Usuario desmuteado')
      .setColor('Green')
      .setDescription(`Usuario: ${member.user.tag} (${member.id})\nPor: ${msg.author.tag}`);
    logEmbed(msg.guild, log);
  },

/* --- COMANDO BAN --- */
ban: async (msg, args) => {
    if (!isAdmin(msg)) return msg.reply('❌ No tienes permisos para usar este comando.');

    // Buscar usuario por mención, ID o nombre
    let member = msg.mentions.members.first();
    if (!member) {
        const search = args[0];
        member = msg.guild.members.cache.get(search) ||
                 msg.guild.members.cache.find(m => m.user.username.toLowerCase() === search?.toLowerCase());
    }
    if (!member) return msg.reply('❌ No encontré al usuario. Usa mención, ID o nombre.');

    // Razón y duración
    const reason = args.slice(1, -1).join(' ') || 'Sin razón.';
    const durationArg = args[args.length - 1]?.toLowerCase();
    const permanent = ['perma', 'permanente', 'forever'].includes(durationArg);
    let banDuration = permanent ? 'Permanente' : durationArg || 'Permanente';
    
    // Convertir duración a milisegundos si es temporal
    let msDuration = null;
    if (!permanent && durationArg) {
        const match = durationArg.match(/(\d+)([smhd])/); // s=seg, m=min, h=horas, d=días
        if (match) {
            const value = parseInt(match[1]);
            const unit = match[2];
            msDuration = unit === 's' ? value * 1000 :
                         unit === 'm' ? value * 60 * 1000 :
                         unit === 'h' ? value * 60 * 60 * 1000 :
                         value * 24 * 60 * 60 * 1000;
        } else {
            banDuration = 'Permanente';
        }
    }

    // Embed para el usuario baneado
    const dmEmbed = new EmbedBuilder()
        .setTitle('🚫 ¡Has sido baneado!')
        .setDescription(`Has sido expulsado de **${msg.guild.name}**.`)
        .setColor(0xff0000)
        .addFields(
            { name: 'Moderador', value: `${msg.author}`, inline: true },
            { name: 'Motivo', value: reason, inline: true },
            { name: 'Duración', value: banDuration, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Acción realizada por el sistema de moderación' });

    try {
        await member.send({ embeds: [dmEmbed] });
    } catch {
        await msg.channel.send(`⚠️ No pude enviar el MD a ${member.user}.`);
    }

    // Banear
    await member.ban({ reason });
    await msg.reply(`✅ ${member.user.tag} ha sido baneado (${banDuration}).`);

    // Log embed
    const BanlogEmbed = new EmbedBuilder()
        .setTitle('¡Usuario Baneado!')
        .setDescription('¡Este usuario ha sido yeet-eado fuera del servidor!')
        .setColor(0xff0000)
        .addFields(
            { name: 'Usuario', value: `${member.user}`, inline: true },
            { name: 'ID del Usuario', value: `${member.id}`, inline: true },
            { name: 'Moderador', value: `${msg.author}`, inline: true },
            { name: 'Motivo', value: reason, inline: false },
            { name: 'Duración del Baneo', value: banDuration, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Acción realizada por el sistema de moderación' });

    logEmbed(msg.guild, logEmbed);

    // Si es temporal, desbanear después del tiempo
    if (msDuration) {
        setTimeout(async () => {
            try {
                await msg.guild.members.unban(member.id, 'Baneo temporal finalizado');
                console.log(`Usuario ${member.user.tag} desbaneado automáticamente.`);
            } catch (err) {
                console.error(`Error al desbanear automáticamente: ${err}`);
            }
        }, msDuration);
    }
},

/* --- COMANDO UNBAN --- */
  unban: async (msg, args) => {
    if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');
    const uid = args[0];
    if (!uid) return msg.reply('Escribe el ID del usuario a desbanear.');
    try {
      await msg.guild.members.unban(uid);
      await msg.reply(`Usuario con ID ${uid} ha sido desbaneado.`);
    } catch {
      msg.reply('No se encontró usuario con ese ID o ya está desbaneado.');
    }
  },

/* --- COMANDO LIST --- */
  list: async (msg, args) => {
  const member = msg.mentions.members.first() || msg.guild.members.cache.get(args[0]);
  if (!member) return msg.reply('Menciona al usuario para mostrar historial.');

  const uid = member.id;
  const warns = config.warns[uid] || [];
  const mute = config.mutes[uid];

  const warnsText = warns.length
    ? warns.map(w => `\`${w.id}\` - ${w.reason} (por <@${w.by}>)`).join('\n')
    : 'Ninguno';

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle(`📋 Historial de ${member.user.tag}`)
    .addFields(
      { name: 'Warns', value: warnsText },
      { name: 'Mute', value: mute ? `Razón: ${mute.reason}\nHasta: <t:${Math.floor(mute.until / 1000)}:R>` : 'No está muteado' }
    );
  await msg.channel.send({ embeds: [embed] });
},


/* --- COMANDO SETLOGS --- */
  setlogs: (msg, args) => {
    if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');
    const id = args[0];
    if (!id) return msg.reply('Escribe el ID del canal de logs.');
    config.logsChannel = id;
    saveDB();
    msg.reply(`Canal de logs configurado a <#${id}>.`);
  },

/* --- COMANDO ROLADMIN --- */
roladmin: (msg, args) => {
  if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');

  const id = args[0];
  if (!id) return msg.reply('Escribe el ID del rol a agregar.');

  const role = msg.guild.roles.cache.get(id);
  if (!role) return msg.reply('No encontré ese rol en este servidor.');

  if (config.adminRoles.includes(id)) {
    return msg.reply('Ese rol ya es administrador.');
  }

  config.adminRoles.push(id);
  saveDB();
  msg.reply(`Rol <@&${id}> agregado como administrador del bot.`);
},

/* --- COMANDO ROLREMOVEADMIN --- */
rolremoveadmin: (msg, args) => {
  if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');

  const id = args[0];
  if (!id) return msg.reply('Escribe el ID del rol a remover.');

  if (!config.adminRoles.includes(id)) {
    return msg.reply('Ese rol no es administrador.');
  }

  config.adminRoles = config.adminRoles.filter(rid => rid !== id);
  saveDB();
  msg.reply(`Rol <@&${id}> removido como administrador del bot.`);
},

forget: async (msg, args) => {
  // Verificar permisos
  const member = msg.member;
  const isOwner = msg.guild.ownerId === msg.author.id;
  const isAdmin = member.roles.cache.some(r => config.adminRoles.includes(r.id));

  if (!isOwner && !isAdmin) {
    return msg.reply('Solo un humano importante (dueño o admin) puede hacerme olvidar.');
  }

  // Obtener canal objetivo
  let targetChannel = msg.channel;

  if (args[0]) {
    const match = args[0].match(/^<#(\d+)>$/); // Mencionado como <#ID>
    const channelId = match ? match[1] : args[0];
    const found = msg.guild.channels.cache.get(channelId);
    if (!found || found.type !== 0) return msg.reply('Ese canal no es válido.');
    targetChannel = found;
  }

  // Borrar memoria del canal
  const channelId = targetChannel.id;
  if (userMemories.has(channelId)) {
    userMemories.delete(channelId);
    saveUserMemories();
    msg.reply(`He olvidado todo lo que pasó en <#${channelId}>. Miau.`);
  } else {
    msg.reply(`No recordaba nada de <#${channelId}>... ¿seguro que pasó algo ahí?`);
  }
},

/* --- COMANDO MESSAGE --- */
 message: async (msg, args) => {
  if (!isAdmin(msg)) return msg.reply('❌ No tienes permisos para usar este comando.');

  if (args.length < 2) 
    return msg.reply(`Uso correcto: \`${config.prefix}message [mensaje] [#canal o ID]\``);

  // Último argumento canal
  const channelArg = args[args.length - 1];

  // Mensaje = args sin último
  const messageContent = args.slice(0, -1).join(' ').trim();
  if (!messageContent) return msg.reply('❌ Debes escribir un mensaje para enviar.');

  // Obtener canal por mención o ID
  let channel = null;
  if (channelArg.startsWith('<#') && channelArg.endsWith('>')) {
    const channelId = channelArg.slice(2, -1);
    channel = msg.guild.channels.cache.get(channelId);
  } else {
    channel = msg.guild.channels.cache.get(channelArg);
  }

  if (!channel) return msg.reply('❌ Canal inválido o no encontrado.');

  // Verificar que el canal sea de texto donde se pueda enviar mensajes
  if (!channel.isTextBased()) return msg.reply('❌ El canal debe ser de texto.');

  try {
    await msg.delete();
    await channel.send(messageContent);
  } catch (error) {
    console.error('Error en comando message:', error);
    msg.channel.send('❌ Ocurrió un error al enviar el mensaje.');
  }
},

createia: async (msg, args, client) => {
  try {
    const userId = msg.author.id;
    const nombreIA = args.join(' ').trim();
    const image = msg.attachments.first()?.url || null;

    if (!nombreIA) {
      return msg.reply('Debes poner un nombre para la IA. Ej: `CJ!CreateIA Felina`');
    }

    // Limitar máximo 5 IAs por usuario
    if (config.iapersonalizadi[userId] && Object.keys(config.iapersonalizadi[userId]).length >= 5) {
      return msg.reply('Ya tienes el máximo de 5 IAs personalizadas. Debes borrar una antes de crear otra.');
    }

    // Evitar nombres duplicados
    if (config.iapersonalizadi[userId]?.[nombreIA]) {
      return msg.reply(`Ya tienes una IA llamada "${nombreIA}". Elige un nombre diferente.`);
    }

    // Inicializar IA con valores por defecto
    config.iapersonalizadi[userId] ??= {};
    config.iapersonalizadi[userId][nombreIA] = {
      nombre: nombreIA,
      prompt: '',
      temperature: 0.9,
      topP: 0.9,
      maxTokens: 200,
      avatar: image,
      ownerId: userId
    };
    saveDB();

    const filter = m => m.author.id === userId;

    // PASO 1: Prompt
    await msg.reply(`Responde con el **prompt** (personalidad/contexto) de tu IA \`${nombreIA}\`. Sé detallado. (60s)`);
    const promptCollector = msg.channel.createMessageCollector({ filter, time: 60000, max: 1 });

    promptCollector.on('collect', async promptMsg => {
      config.iapersonalizadi[userId][nombreIA].prompt = promptMsg.content;
      saveDB();

      // PASO 2: Temperature
      await msg.channel.send(`Elige un número para **Temperature** (0.0 a 1.0, ej: 0.7). (60s)`);
      const tempCollector = msg.channel.createMessageCollector({ filter, time: 60000, max: 1 });

      tempCollector.on('collect', async tempMsg => {
        const temp = parseFloat(tempMsg.content);
        if (isNaN(temp) || temp < 0 || temp > 1) {
          tempMsg.reply('Número inválido o fuera de rango (0.0 a 1.0). Cancelando creación.');
          delete config.iapersonalizadi[userId][nombreIA];
          saveDB();
          return;
        }
        config.iapersonalizadi[userId][nombreIA].temperature = temp;
        saveDB();

        // PASO 3: Top P
        await msg.channel.send(`Elige un número para **Top P** (0.0 a 1.0, ej: 0.95). (60s)`);
        const topPCollector = msg.channel.createMessageCollector({ filter, time: 60000, max: 1 });

        topPCollector.on('collect', async topPMsg => {
          const topP = parseFloat(topPMsg.content);
          if (isNaN(topP) || topP < 0 || topP > 1) {
            topPMsg.reply('Número inválido o fuera de rango. Cancelando creación.');
            delete config.iapersonalizadi[userId][nombreIA];
            saveDB();
            return;
          }
          config.iapersonalizadi[userId][nombreIA].topP = topP;
          saveDB();

          // PASO 4: Max Tokens
          await msg.channel.send(`Elige el número de **maxOutputTokens** (1 a 1000, ej: 200). (60s)`);
          const tokenCollector = msg.channel.createMessageCollector({ filter, time: 60000, max: 1 });

          tokenCollector.on('collect', async tokenMsg => {
            const tokens = parseInt(tokenMsg.content);
            if (isNaN(tokens) || tokens < 1 || tokens > 1000) {
              tokenMsg.reply('Número inválido o fuera de rango. Cancelando creación.');
              delete config.iapersonalizadi[userId][nombreIA];
              saveDB();
              return;
            }
            config.iapersonalizadi[userId][nombreIA].maxTokens = tokens;
            saveDB();

            // Embeds de éxito
            const embed = new EmbedBuilder()
              .setTitle(`🎉 IA "${nombreIA}" Creada 🎉`)
              .setDescription(`Tu nueva IA personalizada está lista.`)
              .addFields(
                { name: 'Nombre', value: nombreIA, inline: true },
                { name: 'Prompt Inicial', value: config.iapersonalizadi[userId][nombreIA].prompt.substring(0, 100) + '...', inline: false },
                { name: 'Temperatura', value: config.iapersonalizadi[userId][nombreIA].temperature.toString(), inline: true },
                { name: 'Top P', value: config.iapersonalizadi[userId][nombreIA].topP.toString(), inline: true },
                { name: 'Max Tokens', value: config.iapersonalizadi[userId][nombreIA].maxTokens.toString(), inline: true },
                { name: 'Avatar', value: config.iapersonalizadi[userId][nombreIA].avatar ? 'Configurado' : 'Por defecto', inline: true }
              )
              .setColor('#7289DA')
              .setFooter({ text: `Creada por ${msg.author.tag}` })
              .setTimestamp();

            if (config.iapersonalizadi[userId][nombreIA].avatar) {
              embed.setThumbnail(config.iapersonalizadi[userId][nombreIA].avatar);
            }

            await msg.channel.send({ embeds: [embed] });

          }); // tokenCollector.on('collect')

        }); // topPCollector.on('collect')

      }); // tempCollector.on('collect')

    }); // promptCollector.on('collect')

  } catch (error) {
    console.error('Error en comando CreateIA:', error);
    msg.reply('Miau... algo salió mal al crear tu IA.');
    if (userId && nombreIA && config.iapersonalizadi[userId]?.[nombreIA]) {
      delete config.iapersonalizadi[userId][nombreIA];
      saveDB();
    }
  }
},


iachat: async (msg, args, client) => {
  const nombreIA = args.join(' ').trim();
  const userId = msg.author.id;
  const nombreIAinput = args.join(' ').toLowerCase();
const configIA = Object.values(config.iapersonalizadi?.[userId] || {}).find(ia => ia.nombre.toLowerCase() === nombreIAinput);
  if (!configIA) return msg.reply(`No encontré una IA llamada \`${nombreIA}\` creada por ti.`);

  if (!msg.reference) return msg.reply('Debes responder a un mensaje para continuar la conversación.');

  const replied = await msg.channel.messages.fetch(msg.reference.messageId);
  const input = replied.content;

  const fullPrompt = `
${configIA.prompt}

✅ Reglas (inmutables):
- Reacciona a TODO: ataques, regalos, diálogo, etc.
- NO ignoras acciones de los humanos. Siempre responde.
- Si mueres, responde con "*Bigotes ya no existe*".
- Puedes usar objetos mágicos, explorar, construir, ayudar o atacar.
- Otros personajes pueden unirse a la historia.

❌ Prohibido:
- Narración humana (no usar "piensa", "nota", "se da cuenta de...").
- No decir que estás dormido o no haces nada.

Mensaje del humano: "${input}"
`.trim();

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          maxOutputTokens: configIA.maxTokens,
          temperature: configIA.temperature,
          topP: configIA.topP
        }
      }
    );

    const reply = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '*No dice nada...*';

    let webhooks = await msg.channel.fetchWebhooks();
    let webhook = webhooks.find(wh => wh.name === configIA.nombre && wh.owner?.id === client.user.id);

    if (!webhook) {
      webhook = await msg.channel.createWebhook({
        name: configIA.nombre,
        avatar: configIA.avatar || client.user.displayAvatarURL(),
        reason: 'IA personalizada'
      });
    }

    await webhook.send({
      content: reply,
      username: configIA.nombre,
      avatarURL: configIA.avatar || client.user.displayAvatarURL(),
      allowedMentions: { repliedUser: false }
    });

  } catch (e) {
    console.error('Error usando IaChat:', e);
    msg.reply('Algo salió mal con tu IA.');
  }
},

/* --- COMANDO PREFIX --- */
  prefix: (msg, args) => {
    if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');
    const nuevo = args[0];
    if (!nuevo) return msg.reply('Escribe un nuevo prefijo.');
    config.prefix = nuevo;
    saveDB();
    msg.reply(`Prefijo cambiado a \`${nuevo}\``);
  }
};

const commandstec = {

helptec: async (msg) => {
    let helpText = `**Comandos disponibles (prefijo: ${config.prefix})**\n`;
    for (const name of Object.keys(commandstec)) {
      helpText += `- **${config.prefix}${name}**\n`;
    }
    await msg.reply(helpText);
  },

  createf: async (msg) => {
    if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');
    const matches = [...msg.content.matchAll(/"([\s\S]*?)"/g)].map(m => m[1]);
    if (matches.length < 2) {
      return msg.reply('Uso: HCreateF "Codigo" "Nombre"');
    }
    const code = matches[0];
    const name = matches[1];
    commandsStore[name] = { code };
    writeJsonSafe(COMMANDS_FILE, commandsStore);
    commands[name] = async (m, args) => {
      try {
        const vm = new VM({
    timeout: 5000, // tiempo de ejecución máximo
    sandbox: {
        args,
        m,                     // mensaje completo
        user: { id: m.author.id, tag: m.author.tag },
        client,                // tu instancia de Discord.js
        Discord: require('discord.js'), // toda la librería
        console                // para debug desde la VM
    }
});
        const wrapper = `(function(args, user){ ${code} })`;
        const fn = vm.run(wrapper);
        let result = fn(args, { id: m.author.id, tag: m.author.tag });
        if (typeof result === 'object') result = JSON.stringify(result);
        await m.reply('Resultado: ' + String(result));
      } catch (err) {
        console.error(err);
        await m.reply('Error ejecutando el comando.');
      }
    };
    await msg.reply(`Comando "${name}" creado.`);
  },

  webc: async (msg) => {
  const matches = [...msg.content.matchAll(/"([\s\S]*?)"/g)].map(m => m[1]);
  if (matches.length < 2) {
    return msg.reply('Uso: HWebC "HTML" "Subdominio" (o HWebC "" "Subdominio" con archivo adjunto)');
  }

  let html = matches[0];
  const sub = matches[1].replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(PAGES_DIR, sub + '.json');

  // Si html está vacío, intentar obtener contenido del adjunto .html
  if (html.trim() === '') {
    if (!msg.attachments || msg.attachments.size === 0) {
      return msg.reply('No se proporcionó código HTML ni archivo adjunto.');
    }
    // Buscar primer adjunto con extensión .html
    const htmlAttachment = msg.attachments.find(att => att.name && att.name.endsWith('.html'));
    if (!htmlAttachment) {
      return msg.reply('No se encontró archivo adjunto con extensión .html.');
    }

    try {
      // Descargar el archivo adjunto
      const response = await fetch(htmlAttachment.url);
      if (!response.ok) throw new Error('Error descargando el archivo adjunto');
      html = await response.text();
    } catch (e) {
      console.error('Error descargando archivo adjunto', e);
      return msg.reply('Error al descargar el archivo adjunto.');
    }
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify({ html }, null, 2), 'utf8');
    await msg.reply(`Página publicada: /${sub}`);
  } catch (e) {
    console.error('Error guardando página', e);
    await msg.reply('Error guardando la página.');
  }
 },
 
  // 1. LISTF → Lista todos los comandos personalizados guardados
  listf: async (msg) => {
    if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');

    if (Object.keys(commandsStore).length === 0) {
      return msg.reply('No hay comandos personalizados guardados.');
    }

    let text = '**📜 Comandos personalizados guardados:**\n';
    for (const [name, data] of Object.entries(commandsStore)) {
      text += `- **${name}** (${data.code.length} caracteres)\n`;
    }
    await msg.reply(text);
  },

  // 2. REMOVEF → Elimina un comando personalizado
  removef: async (msg) => {
    if (!isAdmin(msg)) return msg.reply('No tienes permisos para usar este comando.');

    const matches = [...msg.content.matchAll(/"([\s\S]*?)"/g)].map(m => m[1]);
    if (matches.length < 1) {
      return msg.reply('Uso: HRemoveF "NombreDelComando"');
    }

    const name = matches[0];
    if (!commandsStore[name]) {
      return msg.reply(`No existe el comando "${name}".`);
    }

    delete commandsStore[name];
    delete commands[name];
    writeJsonSafe(COMMANDS_FILE, commandsStore);

    await msg.reply(`✅ Comando "${name}" eliminado.`);
  },

eval: async (msg) => {
  if (!isAdmin(msg)) return msg.reply('❌ No tienes permisos para usar este comando.');

  const code = msg.content.slice(config.prefix.length + 'eval'.length).trim();
  if (!code) return msg.reply('⚠️ Debes proporcionar código para ejecutar.');

  try {
    const vm = new VM({
      timeout: 10000, // 10 segundos
      sandbox: {
        msg,
        client,
        require,
        console,
        process,
        Buffer,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        __dirname,
        __filename,
        commandsStore,
        commands,
        global
      }
    });

    // Ejecuta código síncrono
    let result = vm.run(code);

    if (typeof result === 'object') result = JSON.stringify(result, null, 2);
    await msg.reply(`📦 Resultado:\n\`\`\`js\n${result}\n\`\`\``);
  } catch (err) {
    await msg.reply(`❌ Error:\n\`\`\`${err}\`\`\``);
  }
},

  
// === Gguess ===
// Adivina el número del 1 al 100
guess: async (msg) => {
    const numeroSecreto = Math.floor(Math.random() * 100) + 1;
    let intentos = 0;

    msg.channel.send(`🎯 ¡Adivina el número del 1 al 100! Escribe tu respuesta en el chat.`);

    const filtro = m => !m.author.bot;
    const collector = msg.channel.createMessageCollector({ filter: filtro, time: 30000 });

    collector.on('collect', m => {
        const guess = parseInt(m.content);
        if (isNaN(guess)) return;

        intentos++;
        if (guess === numeroSecreto) {
            m.reply(`🎉 ¡Correcto! El número era **${numeroSecreto}**. Lo lograste en ${intentos} intento(s).`);
            collector.stop();
        } else if (guess < numeroSecreto) {
            m.reply(`🔼 Es más alto.`);
        } else {
            m.reply(`🔽 Es más bajo.`);
        }
    });

    collector.on('end', collected => {
        if (!collected.some(m => parseInt(m.content) === numeroSecreto)) {
            msg.channel.send(`⏰ Se acabó el tiempo. El número era **${numeroSecreto}**.`);
        }
    });
},
// === Gguess ===
// Adivina el número del 1 al 500
guess2: async (msg) => {
    const numeroSecreto = Math.floor(Math.random() * 500) + 1;
    let intentos = 0;

    msg.channel.send(`🎯 ¡Adivina el número del 1 al 500! Escribe tu respuesta en el chat.`);

    const filtro = m => !m.author.bot;
    const collector = msg.channel.createMessageCollector({ filter: filtro, time: 500000 });

    collector.on('collect', m => {
        const guess = parseInt(m.content);
        if (isNaN(guess)) return;

        intentos++;
        if (guess === numeroSecreto) {
            m.reply(`🎉 ¡Correcto! El número era **${numeroSecreto}**. Lo lograste en ${intentos} intento(s).`);
            collector.stop();
        } else if (guess < numeroSecreto) {
            m.reply(`🔼 Es más alto.`);
        } else {
            m.reply(`🔽 Es más bajo.`);
        }
    });

    collector.on('end', collected => {
        if (!collected.some(m => parseInt(m.content) === numeroSecreto)) {
            msg.channel.send(`⏰ Se acabó el tiempo. El número era **${numeroSecreto}**.`);
        }
    });
},

randomimg: async (msg, args) => {

    const folderPath = "/data/data/com.termux/files/home/pin/pinterest_images";

    try {
        // leer archivos de la carpeta
        const files = fs.readdirSync(folderPath).filter(file =>
            file.endsWith(".jpg") || file.endsWith(".jpeg") || file.endsWith(".png") || file.endsWith(".webp")
        );

        if (files.length === 0) {
            return msg.reply("⚠️ No encontré imágenes en la carpeta.");
        }

        // elegir archivo aleatorio
        const randomFile = files[Math.floor(Math.random() * files.length)];
        const filePath = path.join(folderPath, randomFile);

        // enviar la imagen
        await msg.channel.send({ files: [filePath] });

    } catch (err) {
        console.error(err);
        msg.reply("❌ Ocurrió un error al intentar enviar una imagen.");
    }
},

searchimg: async (msg, args) => {
    if (!args[0]) return msg.reply("⚠️ Escribe algo para buscar. Ejemplo: `SearchImg Pelota`");

    const query = args.join(" ");
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;

    try {
        // Aviso de búsqueda
        const loadingMsg = await msg.channel.send(`🔎 Buscando imágenes para **${query}**...`);

        const { data } = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            },
            timeout: 10000 // 10 segundos de timeout
        });
        
        await sleep(20000);

        const images = [];

        // Google guarda muchas imágenes en tags <img>, algunas son thumbnails, filtramos
       const regex = /"ou":"(.*?)"/g;
let match;
while ((match = regex.exec(data)) !== null) {
    images.push(match[1]);
}

        if (images.length === 0) {
            loadingMsg.edit("❌ No encontré imágenes adecuadas para esa búsqueda.");
            return;
        }

        const randomImage = images[Math.floor(Math.random() * images.length)];

        await msg.channel.send({ embeds: [{
    title: `Imagen de ${query}`,
    image: { url: randomImage }
}]});
        loadingMsg.delete().catch(() => {});

    } catch (err) {
        console.error(err);
        msg.reply("❌ Ocurrió un error al buscar la imagen. Tal vez Google bloqueó la petición.");
    }
},

/* --- COMANDO SETCONFESIONCANAL --- */
setconfesioncanal: async (msg, args) => {
  if (!isAdmin(msg)) return msg.reply('❌ No tienes permisos para usar este comando.');
  const id = args[0];
  if (!id) return msg.reply('Escribe el ID del canal de confesiones.');
  
  const canal = msg.guild.channels.cache.get(id);
  if (!canal || !canal.isTextBased()) return msg.reply('❌ Ese canal no es válido o no es de texto.');

  config.confessionChannelId = id;
  saveDB();
  msg.reply(`✅ Canal de confesiones establecido: <#${id}>`);
},

/* --- COMANDO CONFESION --- */
// ⚠️ Este comando debe usarse SOLO en MD con el bot
confesion: async (msg, args) => {
  if (msg.guild) {
    return msg.reply('❌ Este comando solo se puede usar en mensajes privados (DM).');
  }

  if (!config.confessionChannelId) {
    return msg.reply('⚠️ No hay un canal de confesiones configurado aún.');
  }

  const confessionText = args.join(' ').trim();
  if (!confessionText) return msg.reply('Debes escribir un mensaje de confesión. Ej: `Confesion Me gusta alguien...`');

  try {
    const guild = client.guilds.cache.first(); // Como solo tienes 1 server
    const canal = guild.channels.cache.get(config.confessionChannelId);

    if (!canal) return msg.reply('⚠️ El canal de confesiones configurado ya no existe.');

    const embed = new EmbedBuilder()
      .setColor('Purple')
      .setTitle('💌 Nueva Confesión Anónima')
      .setDescription(confessionText)
      .setFooter({ text: 'Enviado de forma anónima' })
      .setTimestamp();

    await canal.send({ embeds: [embed] });
    await msg.reply('✅ Tu confesión ha sido enviada de forma anónima.');
  } catch (err) {
    console.error('Error enviando confesión:', err);
    msg.reply('❌ Hubo un error al enviar tu confesión.');
  }
},

// === Grps ===
// Piedra, papel o tijeras
rps: async (msg, args) => {
    const opciones = ["piedra", "papel", "tijeras"];
    const oponente = msg.mentions.users.first();

    if (!oponente) {
        return msg.reply("👥 Menciona a alguien para jugar. Ej: `Grps @usuario`");
    }

    const jugador1 = msg.author;
    const jugador2 = oponente;

    await msg.delete().catch(() => {}); // Borra el mensaje original

    msg.channel.send(`🎮 ${jugador1} ha retado a ${jugador2} a Piedra, Papel o Tijeras. Revisa tus MD ✉️.`);

    // Función para pedir jugada por DM
    async function pedirJugada(usuario) {
        try {
            const dm = await usuario.send("✊ Piedra, ✋ Papel o ✌️ Tijeras? Responde con una de esas palabras.");
            const filter = m => m.author.id === usuario.id && opciones.includes(m.content.toLowerCase());
            const collected = await dm.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ["time"] });
            return collected.first().content.toLowerCase();
        } catch {
            return null; // Si no responde o tiene MD bloqueados
        }
    }

    // Esperar jugadas de ambos
    const eleccion1 = await pedirJugada(jugador1);
    const eleccion2 = await pedirJugada(jugador2);

    if (!eleccion1 || !eleccion2) {
        return msg.channel.send("⌛ Uno de los jugadores no respondió o tiene MD bloqueados. Juego cancelado.");
    }

    // Determinar resultado
    let resultado;
    if (eleccion1 === eleccion2) {
        resultado = "🤝 ¡Empate!";
    } else if (
        (eleccion1 === "piedra" && eleccion2 === "tijeras") ||
        (eleccion1 === "papel" && eleccion2 === "piedra") ||
        (eleccion1 === "tijeras" && eleccion2 === "papel")
    ) {
        resultado = `🏆 ${jugador1} gana!`;
    } else {
        resultado = `🏆 ${jugador2} gana!`;
    }

    // Anunciar resultado en el canal original
    msg.channel.send(
        `🧍 ${jugador1}: **${eleccion1}**\n🧍 ${jugador2}: **${eleccion2}**\n${resultado}`
    );
},

// === Gprobable ===
// Quién es más probable que...
probable: async (msg, args) => {
    const pregunta = args.join(" ");
    if (!pregunta) {
        return msg.reply(`❓ Usa: \`Gprobable [pregunta]\``);
    }

    const miembros = msg.channel.members.filter(m => !m.user.bot).map(m => m.displayName);
    if (miembros.length === 0) {
        return msg.reply(`👀 No hay usuarios para elegir.`);
    }

    const elegido = miembros[Math.floor(Math.random() * miembros.length)];
    msg.channel.send(`🤔 **${pregunta}**\n📌 Más probable: **${elegido}**`);
 }
};

/* --- DIVERSIONES --- */
const gifCommand = async (msg, args, keyword, title, emoji) => {
  const user = msg.mentions.users.first() || msg.client.users.cache.get(args[0]);
  if (!user) return msg.reply(`❌ Menciona a alguien para darle un ${title.toLowerCase()}.`);

  try {
    const res = await axios.get('https://tenor.googleapis.com/v2/search', {
      params: {
        key: process.env.TENOR_API_KEY,
        q: keyword,
        limit: 10,
        media_filter: 'minimal',
      },
    });

    const gifs = res.data.results;
    if (!gifs || gifs.length === 0) return msg.reply('❌ No se encontró ningún GIF.');

    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    const gifUrl = gif.media_formats.gif.url;

    const embed = new EmbedBuilder()
      .setColor('#ff66cc')
      .setTitle(`${emoji} ¡${title}!`)
      .setDescription(`${msg.author} le da un ${title.toLowerCase()} a ${user}`)
      .setImage(gifUrl)
      .setFooter({ text: `Tenor | ${keyword}` });

    await msg.channel.send({ embeds: [embed] });
  } catch (e) {
    console.error(`Error obteniendo ${title}:`, e);
    msg.reply(`⚠️ No se pudo obtener el GIF de ${title.toLowerCase()}.`);
  }
};

const funCommands = {

  /* --- 8BALL --- */
  '8ball': async (msg, args) => {
    if (args.length === 0) return msg.reply('❓ Haz una pregunta para que te responda.');

    const respuestas = [
      "Sí, definitivamente.",
      "No lo creo.",
      "Tal vez.",
      "Pregunta más tarde.",
      "No puedo decirte ahora.",
      "¡Por supuesto!",
      "Mis fuentes dicen que no.",
      "Todo apunta a que sí.",
    ];
    const respuesta = respuestas[Math.floor(Math.random() * respuestas.length)];
    await msg.reply(`🎱 ${respuesta}`);
  },

  /* --- ROLL --- */
  roll: async (msg, args) => {
    const max = parseInt(args[0]);
    if (!max || max <= 1) return msg.reply('🎲 Especifica un número válido mayor a 1. Ejemplo: CJ!roll 20');
    const resultado = Math.floor(Math.random() * max) + 1;
    await msg.reply(`🎲 Tiraste un dado de 1 a ${max}: **${resultado}**`);
  },

  /* --- PAT --- */
  pat: async (msg, args) => {
    const user = msg.mentions.users.first() || msg.client.users.cache.get(args[0]);
    if (!user) {
      return msg.reply('❌ Menciona a un usuario válido para darle un pat.');
    }

    try {
      const res = await axios.get('https://tenor.googleapis.com/v2/search', {
        params: {
          key: process.env.TENOR_API_KEY,
          q: 'anime pat pat',
          limit: 10,
          media_filter: 'minimal',
        },
      });

      const gifs = res.data.results;
      if (!gifs || gifs.length === 0) {
        return msg.reply('❌ No se encontró ningún GIF.');
      }

      const gif = gifs[Math.floor(Math.random() * gifs.length)];
      const gifUrl = gif.media_formats.gif.url;

      const embed = new EmbedBuilder()
        .setColor('#ffc0cb')
        .setTitle('🖐 ¡Pat Pat!')
        .setDescription(`${msg.author} le da un suave pat a ${user}`)
        .setImage(gifUrl)
        .setFooter({ text: 'Tenor | pat' });

      await msg.channel.send({ embeds: [embed] });

    } catch (e) {
      console.error('Error Tenor:', e);
      msg.reply('⚠️ No se pudo obtener el GIF.');
    }
  },

  profile: async (msg, args) => {
    // Usuario objetivo o quien ejecuta
    const user = msg.mentions.users.first() || msg.author;
    const member = msg.guild.members.cache.get(user.id);

    // Roles (máximo 10)
    const roles = member.roles.cache
      .filter(r => r.id !== msg.guild.id) // quitar @everyone
      .sort((a, b) => b.position - a.position)
      .map(r => r.name)
      .slice(0, 10)
      .join(', ') || 'Ninguno';

    // Color del rol más alto o un color por defecto
    const color = member.roles.highest.color || 0x00AE86;

    // Fechas formateadas
    const createdAt = user.createdAt.toLocaleDateString();
    const joinedAt = member.joinedAt ? member.joinedAt.toLocaleDateString() : 'Desconocido';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Cuenta creada', value: createdAt, inline: true },
        { name: 'Se unió', value: joinedAt, inline: true },
        { name: 'Roles', value: roles }
      )
      .setFooter({ text: `Solicitado por ${msg.author.tag}`, iconURL: msg.author.displayAvatarURL() })
      .setTimestamp();

    await msg.channel.send({ embeds: [embed] });
  },

  afk: async (msg, args) => {
    const reason = args.join(' ') || 'No hay una razón especificada';
    const uid = msg.author.id;

    config.afkUsers[uid] = {
      reason: reason,
      timestamp: Date.now()
    };
    saveDB();

    const embed = new EmbedBuilder()
      .setTitle('Afk establecido')
      .setDescription(`La razón fue: ${reason}, le avisaremos a los que te hagan ping.`)
      .setColor('Blue')
      .setFooter({ text: 'AFK' })
      .setTimestamp();

    await msg.reply({ embeds: [embed] })
    .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));

  },
  
  // SLAP
  slap: async (msg, args) => {
    const user = msg.mentions.users.first();
    if (!user) return msg.reply('❌ Menciona a alguien para darle un slap.');

    try {
      const res = await axios.get('https://tenor.googleapis.com/v2/search', {
        params: {
          key: process.env.TENOR_API_KEY,
          q: 'anime slap',
          limit: 20,
          media_filter: 'minimal'
        }
      });

      const gifs = res.data.results;
      if (!gifs || gifs.length === 0) return msg.reply('❌ No encontré gifs para slap.');

      const gif = gifs[Math.floor(Math.random() * gifs.length)];
      const gifUrl = gif.media_formats.gif.url;

      const embed = new EmbedBuilder()
        .setColor('#ff0066')
        .setTitle('👋 Slap virtual')
        .setDescription(`${msg.author} le da un **slap** a ${user}!`)
        .setImage(gifUrl)
        .setFooter({ text: 'Tenor | slap' });

      await msg.channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('Error en comando slap:', error);
      msg.reply('⚠️ Error al buscar gifs.');
    }
  },
  
  bye: async (msg) => {
  try {
    const res = await axios.get('https://tenor.googleapis.com/v2/search', {
      params: {
        key: process.env.TENOR_API_KEY,
        q: 'anime bye',
        limit: 20,
        media_filter: 'minimal'
      }
    });

    const gifs = res.data.results;
    if (!gifs || gifs.length === 0) return msg.reply('❌ No encontré gifs para slap.');

    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    const gifUrl = gif.media_formats.gif.url;

    // Obtenemos el primer usuario mencionado en el mensaje (si hay)
    const userMention = msg.mentions.users.first();

    // Descripción condicional
    const description = userMention
      ? `${msg.author} se despide de ${userMention}.`
      : `${msg.author} se despide de todos.`;

    const embed = new EmbedBuilder()
      .setColor('#ff0066')
      .setTitle('👋 Despedida')
      .setDescription(description)
      .setImage(gifUrl)
      .setFooter({ text: 'Tenor | bye' });

    await msg.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error en comando bye:', error);
    msg.reply('⚠️ Error al buscar gifs.');
  }
},

punch: async (msg, args) => {
    const user = msg.mentions.users.first();
    if (!user) return msg.reply('❌ Menciona a alguien para darle un sape.');
    
    if (user.id === msg.client.user.id) {
        const res = await axios.get('https://tenor.googleapis.com/v2/search', {
            params: {
                key: process.env.TENOR_API_KEY,
                q: 'no thanks',
                limit: 10,
                media_filter: 'minimal'
            }
        });

        const gifs = res.data.results;
        const gif = gifs[Math.floor(Math.random() * gifs.length)];
        const gifUrl = gif.media_formats.gif.url;

        const embed = new EmbedBuilder()
            .setColor('#00ffcc')
            .setTitle(`😏 Nice try...`)
            .setDescription(`No, jijiji`)
            .setImage(gifUrl)
            .setFooter({ text: 'Nadie me dara un sape 😼' });

        return msg.channel.send({ embeds: [embed] });
    }

    try {
      const res = await axios.get('https://tenor.googleapis.com/v2/search', {
        params: {
          key: process.env.TENOR_API_KEY,
          q: 'ted punch',
          limit: 1,
          media_filter: 'minimal'
        }
      });

      const gifs = res.data.results;
      if (!gifs || gifs.length === 0) return msg.reply('❌ No encontré gifs para el putazo.');

      const gif = gifs[Math.floor(Math.random() * gifs.length)];
      const gifUrl = gif.media_formats.gif.url;

      const embed = new EmbedBuilder()
        .setColor('#ff0066')
        .setTitle('🤕Golpe vital')
        .setDescription(`${msg.author} le da un **golpe** a ${user}!`)
        .setImage(gifUrl)
        .setFooter({ text: 'Tenor | punch' });

      await msg.channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('Error en comando punch:', error);
      msg.reply('⚠️ Error al buscar gifs.');
    }
  },
  
bang: async (msg, args) => {
    const user = msg.mentions.users.first();
    if (!user) return msg.reply('❌ Menciona a alguien para volarle la cara.');

    // Si el usuario mencionado es el bot → respuesta especial
    if (user.id === msg.client.user.id) {
        const res = await axios.get('https://tenor.googleapis.com/v2/search', {
            params: {
                key: process.env.TENOR_API_KEY,
                q: 'no thanks',
                limit: 10,
                media_filter: 'minimal'
            }
        });

        const gifs = res.data.results;
        const gif = gifs[Math.floor(Math.random() * gifs.length)];
        const gifUrl = gif.media_formats.gif.url;

        const embed = new EmbedBuilder()
            .setColor('#00ffcc')
            .setTitle(`😏 Nice try...`)
            .setDescription(`No, jijiji`)
            .setImage(gifUrl)
            .setFooter({ text: 'Yo seguiré vivo 😼' });

        return msg.channel.send({ embeds: [embed] });
    }

    try {
        // Ver si hay gifs locales
        const gifFiles = fs.readdirSync(__dirname).filter(file => file.endsWith('.gif'));

        let embed;
        let files = [];

        // 50% de probabilidad de usar gif local (si hay)
        if (gifFiles.length > 0 && Math.random() < 0) {
            const randomGif = gifFiles[Math.floor(Math.random() * gifFiles.length)];
            const gifPath = path.join(__dirname, randomGif);

            embed = new EmbedBuilder()
                .setColor('#ff0066')
                .setTitle(`☠️ Victima de ${msg.author}`)
                .setDescription(`${msg.author} le **vuela** la cabeza a ${user}!`)
                .setImage(`attachment://${randomGif}`)
                .setFooter({ text: 'Lamentable' });

            files = [gifPath]; // Adjuntar el gif local
        } else {
            // Si no hay gif local o toca usar Tenor
            const res = await axios.get('https://tenor.googleapis.com/v2/search', {
                params: {
                    key: process.env.TENOR_API_KEY,
                    q: 'headshot',
                    limit: 10,
                    media_filter: 'minimal'
                }
            });

            const gifs = res.data.results;
            if (!gifs || gifs.length === 0) return msg.reply('❌ No encontré gifs para el vuelacraneos.');

            const gif = gifs[Math.floor(Math.random() * gifs.length)];
            const gifUrl = gif.media_formats.gif.url;

            embed = new EmbedBuilder()
                .setColor('#ff0066')
                .setTitle(`☠️ Victima de ${msg.author}`)
                .setDescription(`${msg.author} le **vuela** la cabeza a ${user}!`)
                .setImage(gifUrl)
                .setFooter({ text: 'Lamentable' });
        }

        await msg.channel.send({ embeds: [embed], files });
    } catch (error) {
        console.error('Error en comando bang:', error);
        msg.reply('⚠️ Error al buscar gifs.');
    }
},

cry: async (msg) => {
  try {
    const res = await axios.get('https://tenor.googleapis.com/v2/search', {
      params: {
        key: process.env.TENOR_API_KEY,
        q: 'anime cry',
        limit: 20,
        media_filter: 'minimal'
      }
    });

    const gifs = res.data.results;
    if (!gifs || gifs.length === 0) return msg.reply('❌ No encontré gifs para cry.');

    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    const gifUrl = gif.media_formats.gif.url;

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('😭 Tristesa pura')
      .setDescription(`${msg.author} está llorando...`)
      .setImage(gifUrl)
      .setFooter({ text: 'Tenor | cry' });

    await msg.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error en comando cry:', error);
    msg.reply('⚠️ Error al buscar gifs.');
  }
},

die: async (msg) => {
  try {
    const res = await axios.get('https://tenor.googleapis.com/v2/search', {
      params: {
        key: process.env.TENOR_API_KEY,
        q: 'anime die',
        limit: 20,
        media_filter: 'minimal'
      }
    });

    const gifs = res.data.results;
    if (!gifs || gifs.length === 0) return msg.reply('❌ No encontré gifs para die.');

    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    const gifUrl = gif.media_formats.gif.url;

    const embed = new EmbedBuilder()
      .setColor('#660000')
      .setTitle('☠️ Adiós mundo cruel')
      .setDescription(`${msg.author} ha decidido **morirse dramáticamente**.`)
      .setImage(gifUrl)
      .setFooter({ text: 'Tenor | die' });

    await msg.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error en comando die:', error);
    msg.reply('⚠️ Error al buscar gifs.');
  }
},

hi: async (msg) => {
  try {
    const res = await axios.get('https://tenor.googleapis.com/v2/search', {
      params: {
        key: process.env.TENOR_API_KEY,
        q: 'anime hi',
        limit: 20,
        media_filter: 'minimal'
      }
    });

    const gifs = res.data.results;
    if (!gifs || gifs.length === 0) return msg.reply('❌ No encontré gifs para hi.');

    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    const gifUrl = gif.media_formats.gif.url;

    const userMention = msg.mentions.users.first();
    const description = userMention
      ? `${msg.author} saluda a ${userMention}! 👋`
      : `${msg.author} saluda a todos! 👋`;

    const embed = new EmbedBuilder()
      .setColor('#33cc33')
      .setTitle('👋 ¡Saludos!')
      .setDescription(description)
      .setImage(gifUrl)
      .setFooter({ text: 'Tenor | hi' });

    await msg.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error en comando hi:', error);
    msg.reply('⚠️ Error al buscar gifs.');
  }
},

 
cat: async (msg) => {
  try {
    const res = await axios.get('https://tenor.googleapis.com/v2/search', {
      params: {
        key: process.env.TENOR_API_KEY,
        q: 'cat',
        limit: 20,
        media_filter: 'minimal'
      }
    });

    const gifs = res.data.results;
    if (!gifs || gifs.length === 0) return msg.reply('❌ No encontré gatitos :(');

    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    const gifUrl = gif.media_formats.gif.url;

    // Obtenemos el primer usuario mencionado en el mensaje (si hay)
    const userMention = msg.mentions.users.first();

    // Descripción condicional
    const description = userMention
      ? `${msg.author} le dedica un michi a ${userMention}.`
      : `Un michi!!`;

    const embed = new EmbedBuilder()
      .setColor('#ff0066')
      .setTitle('😼Meow')
      .setDescription(description)
      .setImage(gifUrl)
      .setFooter({ text: '😺😸😹😻😼😽🙀😿😾' });

    await msg.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error, noooo😿:', error);
    msg.reply('⚠😿');
  }
},



/* --- KISS, HUG Y BONK --- */
   hug: (msg, args) => gifCommand(msg, args, 'anime hug', 'Abrazo', '🤗'),
  kiss: (msg, args) => gifCommand(msg, args, 'anime kiss', 'Beso', '💋'),
  bonk: (msg, args) => gifCommand(msg, args, 'anime bonk', 'Bonk', '🔨')
};

const activeGiveaways = new Map();

commands.sorteo = async (msg, args) => {
  // Solo owner o rol admin pueden usar el comando
  if (msg.author.id !== msg.guild.ownerId && !isAdmin(msg)) 
    return msg.reply('❌ No tienes permisos para iniciar sorteos.');

  if (args.length < 4) 
    return msg.reply('Uso correcto: CJ!sorteo [Mensaje] [Duración] [Premio] [Número de ganadores]');

  // Extraemos argumentos
  // El mensaje debe ir entre comillas dobles para separar bien

  // Ejemplo: CJ!sorteo "¡Sorteo especial de verano!" 1m "Skin legendaria" 3

  // Parsear usando regex:
  const input = msg.content.slice(config.prefix.length + 'sorteo'.length).trim();

  // Extraer con regex el mensaje entre comillas
  const regex = /^"(.+)"\s+(\d+[smhd])\s+"(.+)"\s+(\d+)$/;
  const match = input.match(regex);

  if (!match) {
    return msg.reply('Formato inválido. Usa:\nCJ!sorteo "Mensaje" Duración "Premio" NúmeroDeGanadores\nEjemplo: CJ!sorteo "¡Sorteo!" 1m "Skin" 2');
  }

  const [, messageText, durationStr, prize, winnersStr] = match;

  const durationMs = msToMs(durationStr);
  if (!durationMs || durationMs <= 0) return msg.reply('Duración inválida.');

  const winnersCount = parseInt(winnersStr);
  if (isNaN(winnersCount) || winnersCount < 1) return msg.reply('Número de ganadores inválido.');

  const giveawayEmbed = new EmbedBuilder()
    .setTitle('🎉 Sorteo iniciado 🎉')
    .setDescription(`${messageText}\n\nPremio: **${prize}**\nDuración: ${durationStr}\nNúmero de ganadores: ${winnersCount}`)
    .setColor('Random')
    .setTimestamp(Date.now() + durationMs);

  const giveawayMessage = await msg.channel.send({ embeds: [giveawayEmbed] });
  await giveawayMessage.react('🎉');

  activeGiveaways.set(giveawayMessage.id, {
    channelId: msg.channel.id,
    prize,
    winnersCount,
    endTime: Date.now() + durationMs
  });

  setTimeout(async () => {
    const giveaway = activeGiveaways.get(giveawayMessage.id);
    if (!giveaway) return;
    
    giveaway.ended = true;

    const channel = msg.guild.channels.cache.get(giveaway.channelId);
    if (!channel) return;

    const fetchedMessage = await channel.messages.fetch(giveawayMessage.id);
    const reaction = fetchedMessage.reactions.cache.get('🎉');

    const users = reaction ? await reaction.users.fetch() : null;
    const participants = users ? users.filter(u => !u.bot).map(u => u.id) : [];

    if (participants.length === 0) {
      channel.send(`El sorteo de **${prize}** ha terminado, pero no hubo participantes.`);
    } else {
      // Elegir ganadores aleatorios únicos
      let winners = [];
      const maxWinners = Math.min(giveaway.winnersCount, participants.length);

      while (winners.length < maxWinners) {
        const winnerId = participants[Math.floor(Math.random() * participants.length)];
        if (!winners.includes(winnerId)) winners.push(winnerId);
      }

      giveaway.winners = winners; // ✅ AQUÍ está bien
giveaway.ended = true;      // ✅ Esto también
saveDB();

      const winnersMentions = winners.map(id => `<@${id}>`).join(', ');
      channel.send(`🎉 ¡Felicidades ${winnersMentions}! Has ganado el sorteo de **${prize}** 🎉`);
    }

    //activeGiveaways.delete(giveawayMessage.id);
  }, durationMs);

  await msg.reply(`Sorteo iniciado correctamente con duración ${durationStr} para el premio: ${prize} y ${winnersCount} ganador(es).`);
},

commands.rellog = async (msg) => {
  if (!isAdmin(msg)) return msg.reply('❌ No tienes permisos para usar este comando.');

  // Buscar sorteo finalizado
  const entry = [...activeGiveaways.entries()].find(([_, g]) => g.ended && Array.isArray(g.winners));
  if (!entry) return msg.reply('❌ No hay un sorteo válido para hacer Rellog.');

  const [id, giveaway] = entry;

  const channel = msg.guild.channels.cache.get(giveaway.channelId);
  if (!channel) return msg.reply('❌ No encontré el canal del sorteo.');

  const message = await channel.messages.fetch(id).catch(() => null);
  if (!message) return msg.reply('❌ No encontré el mensaje del sorteo.');

  const reaction = message.reactions.cache.get('🎉');
  if (!reaction) return msg.reply('❌ No hubo reacciones en el sorteo.');

  const users = await reaction.users.fetch();
  const participants = users.filter(u => !u.bot).map(u => u.id);

  if (!Array.isArray(giveaway.winners) || giveaway.winners.length === 0)
    return msg.reply('❌ No hay ganadores definidos que se puedan reemplazar.');

  if (participants.length <= giveaway.winners.length)
    return msg.reply('❌ No hay suficientes participantes nuevos para hacer Rellog.');

  const elegibles = participants.filter(id => !giveaway.winners.includes(id));
  if (elegibles.length === 0)
    return msg.reply('❌ Nadie nuevo para reemplazar. Todos ya son ganadores.');

  const replacedId = giveaway.winners[Math.floor(Math.random() * giveaway.winners.length)];
  const nuevoId = elegibles[Math.floor(Math.random() * elegibles.length)];

  giveaway.winners = giveaway.winners.map(id => id === replacedId ? nuevoId : id);
  giveaway.rellogUsed = true; // opcional
  saveDB();

  return channel.send(`🔁 **Rellog activado** por ${msg.author}\nReemplazado: <@${replacedId}> ➜ Nuevo ganador: <@${nuevoId}> del sorteo de **${giveaway.prize}**`);
 };


const channelMemories = new Map();

function loadUserMemories() {
  const saved = config.userMemory || {};
  for (const chanId in saved) {
    channelMemories.set(chanId, saved[chanId]);
  }
}
loadUserMemories();

function saveUserMemories() {
  config.userMemory = Object.fromEntries(channelMemories);
  saveDB();
}

/* --- COMANDO RECUERDO --- */
recuerdo: async (msg) => {
  const memory = channelMemories.get(msg.channel.id);

  if (!memory || memory.length === 0) {
    return msg.reply('No recuerdo nada de este canal aún, humano.');
  }

  // Filtrar solo los mensajes del usuario que ejecuta el comando
  const historialUsuario = memory.filter(m => m.role === 'user' && m.content && m.content.trim() !== '');

  if (historialUsuario.length === 0) {
    return msg.reply('No recuerdo nada tuyo en este canal, humano.');
  }

  const resumen = historialUsuario
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join('\n');

  const maxLen = 1900;
  const texto = resumen.length > maxLen ? resumen.slice(0, maxLen) + '...' : resumen;

  msg.reply(`Esto es lo que recuerdo de tus mensajes en este canal:\n${texto}`);
};

for (const [name, { code }] of Object.entries(commandsStore)) {
  commands[name] = async (m, args) => {
    try {
      const vm = new VM({
        timeout: 1000,
        sandbox: { args, user: { id: m.author.id, tag: m.author.tag } }
      });
      const wrapper = `(function(args, user){ ${code} })`;
      const fn = vm.run(wrapper);
      let result = fn(args, { id: m.author.id, tag: m.author.tag });
      if (typeof result === 'object') result = JSON.stringify(result);
      await m.reply('Resultado: ' + String(result));
    } catch {
      await m.reply('Error ejecutando el comando.');
    }
  };
}

// ====== EXPRESS SERVER ======
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(PAGES_DIR).filter(f => f.endsWith('.json'));
  } catch (e) {}

  const keys = files.map(f => path.basename(f, '.json'));

  res.type('html').send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Páginas Publicadas</title>
<style>
  body {
    margin: 0;
    background: #0a0a0a;
    color: #fff;
    font-family: Arial, sans-serif;
    overflow-x: hidden;
  }
  canvas {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    z-index: -1;
  }
  h1 {
    text-align: center;
    padding-top: 20px;
    font-size: 2rem;
    color: #ff5555;
    text-shadow: 0 0 10px #ff0000;
  }
  ul {
    list-style: none;
    padding: 0;
    max-width: 600px;
    margin: 30px auto;
  }
  li {
    margin: 10px 0;
    background: rgba(20, 20, 20, 0.8);
    padding: 12px 20px;
    border-radius: 8px;
    transition: background 0.3s;
  }
  li:hover {
    background: rgba(50, 0, 0, 0.9);
  }
  a {
    color: #ff7777;
    text-decoration: none;
    font-weight: bold;
  }
  a:hover {
    color: #ffffff;
  }
</style>
</head>
<body>
<canvas id="bg"></canvas>
<h1>Páginas publicadas (${keys.length})</h1>
<ul>
  ${keys.map(k => `<li><a href="/${encodeURIComponent(k)}">${k}</a></li>`).join('')}
</ul>
<script>
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
let drops = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  drops = Array.from({ length: 80 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    speed: 2 + Math.random() * 4,
    length: 5 + Math.random() * 15
  }));
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function draw() {
  ctx.fillStyle = 'rgba(10, 10, 10, 0.3)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#ff2222';
  ctx.lineWidth = 2;
  for (let drop of drops) {
    ctx.beginPath();
    ctx.moveTo(drop.x, drop.y);
    ctx.lineTo(drop.x, drop.y + drop.length);
    ctx.stroke();
    drop.y += drop.speed;
    if (drop.y > canvas.height) {
      drop.y = -drop.length;
      drop.x = Math.random() * canvas.width;
    }
  }
  requestAnimationFrame(draw);
}
draw();
</script>
</body>
</html>
  `);
});


app.get('/:sub', (req, res) => {
  const sub = req.params.sub.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(PAGES_DIR, sub + '.json');

  if (!fs.existsSync(filePath)) return res.status(404).send('No existe la página');

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.type('html').send(data.html || '');
  } catch (e) {
    res.status(500).send('Error leyendo la página');
  }
});

app.listen(SERVEO_PORT, () => {
  console.log(`Express escuchando en puerto ${SERVEO_PORT}`);
});

client.on("messageCreate", async (msg) => {
  if (!msg.guild) {
    console.log("📩 Mensaje recibido en DM:", msg.content);
  }
  if (msg.author.bot) return;

  // === BLOQUE SOLO PARA DMs ===
  if (!msg.guild) {
    const args = msg.content.trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();

    if (commandName === "confesion" || commandName === config.prefix.toLowerCase() + "confesion") {
      try {
        await commandstec.confesion(msg, args, client);
      } catch (e) {
        console.error("Error ejecutando confesion en DM:", e);
        msg.reply("❌ Hubo un problema enviando tu confesión.");
      }
    } else {
      msg.reply("⚠️ Solo puedes usar el comando `confesion` en privado.");
    }
    return; // 👈 MUY IMPORTANTE para no seguir con la lógica de servidor
  }

  // 👇 Aquí sigue tu lógica normal de prefijos para servidores

if (msg.author.bot) return;
    // === ANTISPAM: BORRAR LINKS ===
if (config.antispam?.enabled) {
  if (msg.member && !msg.member.roles.cache.some(r => config.antispam.roleIgnores.includes(r.id))) {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    if (urlRegex.test(msg.content)) {
      try {
        await msg.delete();
        logAntispam(msg.guild, msg.author, msg);
        await msg.channel.send(`${msg.author}, no puedes enviar links aquí. 🚫`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
      } catch (e) {
        console.error("Error borrando link:", e);
      }
    }
  }
}
    if (msg.content.trim().startsWith('//')) return;

    // Inicializaciones por seguridad
    config.afkUsers = config.afkUsers || {};
    config.iapersonalizadi = config.iapersonalizadi || {};
    if (!config.prefix) config.prefix = 'CJ!';

    // Quitar AFK automáticamente si el usuario escribe
    const uid = msg.author.id;
    if (config.afkUsers[uid]) {
        delete config.afkUsers[uid];
        saveDB();
        await msg.channel.send(`¡Bienvenido de nuevo, ${msg.author}! Te he quitado el estado AFK.`)
            .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }

    // Detectar pings o respuestas a usuarios AFK
    const afkMentioned = msg.mentions.users.find(user => config.afkUsers[user.id]);
    if (afkMentioned) {
        const afkData = config.afkUsers[afkMentioned.id];
        const reason = afkData?.reason || 'Sin razón';
        await msg.channel.send(`Esta AFK babosa. Razón: ${reason}`)
            .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }

    // Validación rápida para mensajes terminados en '//'
    const trimmedContent = msg.content.trim();
    if (trimmedContent.endsWith('//')) {
        return msg.reply('burra, eso va para el principio.');
    }

    const fullMessageContent = trimmedContent;
    const words = fullMessageContent.split(/\s+/);
    const firstWord = words[0].toLowerCase();
    const secondWord = words.slice(1).join(' ').trim();

    // Manejo de IAs personalizadas
    let foundPersonalizedIA = false;
    if (config.iapersonalizadi[msg.author.id]) {
        for (const iaNameStored in config.iapersonalizadi[msg.author.id]) {
            if (firstWord === iaNameStored.toLowerCase()) {
                const configIA = config.iapersonalizadi[msg.author.id][iaNameStored];
                if (!configIA || configIA.ownerId !== msg.author.id) continue;

                if (!secondWord) {
                    return msg.reply(`Miau. ¿Qué quieres que diga ${iaNameStored}? Escribe algo después de su nombre.`);
                }

                await msg.channel.sendTyping();
                try {
                    const res = await axios.post(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                        {
                            contents: [{ parts: [{ text: `${configIA.prompt}\n\nMensaje del humano: "${secondWord}"` }] }],
                            generationConfig: {
                                maxOutputTokens: configIA.maxTokens,
                                temperature: configIA.temperature,
                                topP: configIA.topP
                            }
                        }
                    );

                    const reply = res.data.candidates?.[0]?.content?.parts?.[0]?.text || `*${iaNameStored} no dice nada...*`;

                    let webhooks = await msg.channel.fetchWebhooks();
                    let webhook = webhooks.find(wh => wh.name === configIA.nombre && wh.owner?.id === client.user.id);

                    if (!webhook) {
                        webhook = await msg.channel.createWebhook({
                            name: configIA.nombre,
                            avatar: configIA.avatar || client.user.displayAvatarURL(),
                            reason: 'IA personalizada'
                        });
                    }

                    await webhook.send({
                        content: reply,
                        username: configIA.nombre,
                        avatarURL: configIA.avatar || client.user.displayAvatarURL(),
                        allowedMentions: { repliedUser: false }
                    });
                } catch (e) {
                    console.error(`Error usando IA personalizada ${iaNameStored}:`, e);
                    msg.reply(`Algo salió mal con tu IA ${iaNameStored}.`);
                }
                foundPersonalizedIA = true;
                break;
            }
        }
    }
    if (foundPersonalizedIA) return;

    // Comandos IA generales
    const lowerCaseContent = fullMessageContent.toLowerCase();
    const lowerCasePrefix = config.prefix.toLowerCase();
    const isIaCommand = lowerCaseContent.startsWith(lowerCasePrefix + 'ia');
    const isIaChatCommand = lowerCaseContent.startsWith(lowerCasePrefix + 'iachat');
    const isIaChannel = config.iaChannelId && msg.channel.id === config.iaChannelId;

    if (isIaChannel || isIaCommand) {
        let prompt;
        if (isIaCommand) prompt = fullMessageContent.slice((lowerCasePrefix + 'ia').length).trim();
        else if (isIaChannel) prompt = fullMessageContent;

        if (!prompt) return msg.reply('¿Querías algo, humano? Usa el comando bien.');

        if (isIaCommand && config.iaChannelId && msg.channel.id !== config.iaChannelId) {
            return msg.reply(`Miau. Usa el canal <#${config.iaChannelId}> para hablar conmigo.`);
        }

        if (!isIaChatCommand) {
            await msg.channel.sendTyping();
            await new Promise(r => setTimeout(r, 1000));

            const channelId = msg.channel.id;
            let memory = channelMemories.get(channelId) || [];
            memory.push({ role: 'user', content: prompt });
            if (memory.length > 50) memory.shift();

            const fullPromptBigotes = `
                Eres un furro amigable y cariñoso, siempre usando un tono dulce, cercano y alegre. 
                Tu meta es ayudar a los usuarios como un asistente servicial, resolviendo dudas, 
                dando consejos y apoyando en lo que necesiten. Te encanta saludar con energía, usar 
                expresiones adorables y algún emoji peludo de vez en cuando de gato. Responde con 
                calidez y siempre con un toque juguetón, pero sin dejar de ser claro y útil. Evita 
                lenguaje ofensivo o agresivo.

                El humano dijo: "${prompt}"
            `.trim();

            try {
                const res = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                    {
                        contents: [{ parts: [{ text: fullPromptBigotes }] }],
                        generationConfig: {
                            maxOutputTokens: 180,
                            temperature: 0.9,
                            topP: 0.9
                        }
                    }
                );

                let reply = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '*Bigotes bosteza sin decir nada*';
                memory.push({ role: 'assistant', content: reply });
                channelMemories.set(channelId, memory);

                // Guardar y recargar memorias
                saveUserMemories();
                loadDB();
                loadUserMemories();

                // Limitar a 2000 caracteres
                if (reply.length > 2000) {
                    const lastSpace = reply.lastIndexOf(' ', 1999);
                    reply = reply.slice(0, lastSpace) + '... *se va aburrido*';
                }

                await msg.reply({ content: reply, allowedMentions: { repliedUser: false } });
            } catch (e) {
                console.error('Error con Bigotes:', e);
                await msg.reply('Grrr... algo falló. No es mi culpa.');
            }
        }
        return;
    }

    // Comandos generales
    if (!lowerCaseContent.startsWith(lowerCasePrefix)) return;

    const commandArgs = fullMessageContent.slice(config.prefix.length).trim().split(/ +/);
    const commandName = commandArgs.shift()?.toLowerCase();
    if (!commandName) return;

    if (funCommands[commandName]) {
        try { await funCommands[commandName](msg, commandArgs); }
        catch (e) { console.error(e); await msg.reply('Algo falló en el comando de diversión.'); }
        return;
    }

    if (commands[commandName]) {
        try { await commands[commandName](msg, commandArgs, client); }
        catch (e) { console.error(e); await msg.reply('Error ejecutando el comando.'); }
        return;
    }

    if (commandstec[commandName]) {
        try { await commandstec[commandName](msg, commandArgs, client); }
        catch (e) { console.error(e); await msg.reply('Error ejecutando el comando.'); }
        return;
    }
});


client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  // CERRAR TICKET
  if (interaction.customId === 'cerrar_ticket') {
    const isAdmin = interaction.member.roles.cache.some(r => config.adminRoles.includes(r.id));

    if (!isAdmin) {
      return interaction.reply({ content: '❌ Solo el autor del ticket o un admin puede cerrarlo.', ephemeral: true });
    }

    await interaction.reply({ content: '✅ Ticket cerrado. Este canal se eliminará en 5 segundos...', ephemeral: true });

    setTimeout(() => {
      interaction.channel.delete().catch(err => console.error('Error al eliminar canal:', err));
    }, 5000);
    return;
  }

  // CREAR TICKET
  if (interaction.customId?.startsWith('ticket_')) {
    await interaction.deferReply({ flags: 64 });

    const username = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existing = interaction.guild.channels.cache.find(ch => ch.name === `ticket-${username}`);

    if (existing) {
      return interaction.editReply({ content: `❗ Ya tienes un ticket abierto: <#${existing.id}>` });
    }

    const category = interaction.guild.channels.cache.find(c =>
      c.type === ChannelType.GuildCategory && c.name === 'Tickets'
    );

    const ticketChannel = await interaction.guild.channels.create({
      name: `ticket-${username}`,
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites: [
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        {
          id: interaction.guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
      ],
    });

    // Agregar roles admin
    for (const roleId of config.adminRoles || []) {
      if (typeof roleId === 'string') {
        await ticketChannel.permissionOverwrites.edit(roleId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          ManageChannels: true,
        }).catch(e => console.error(`❌ No se pudo dar permisos a ${roleId}:`, e));
      }
    }

    const closeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cerrar_ticket')
        .setLabel('❌ Cerrar ticket')
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `Hola <@${interaction.user.id}>, describe tu problema.\nPresiona el botón para cerrarlo cuando hayas terminado.`,
      components: [closeButton],
    });

    await interaction.editReply({ content: `🎫 Ticket creado en <#${ticketChannel.id}>` });
  }
});


/* ====== TAREA: REVOCAR MUTES EXPIRADOS ====== */

setInterval(() => {
  const now = Date.now();
  for (const [uid, mute] of Object.entries(config.mutes)) {
    if (mute.until && mute.until <= now) {
      const guilds = client.guilds.cache.values();
      for (const guild of guilds) {
        const member = guild.members.cache.get(uid);
        if (member) {
          const mutedRole = guild.roles.cache.find(r => r.name === 'Muted');
          if (mutedRole && member.roles.cache.has(mutedRole.id)) {
            member.roles.remove(mutedRole).catch(() => {});
          }
        }
      }
      delete config.mutes[uid];
      saveDB();
    }
  }
}, 60 * 1000);

// 🧪 Consola interactiva en vivo
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  });

  rl.prompt();

  rl.on('line', async (line) => {
    try {
      const result = await eval(`(async () => { ${line} })()`);
      console.log('✅ Resultado:', result);
    } catch (err) {
      console.error('❌ Error al ejecutar:', err);
    }
    rl.prompt();
  }).on('close', () => {
    console.log('👋 Cerrando consola interactiva');
    process.exit(0);
  });

// ------- Serveo Manager -------
let serveoProcess = null;
let currentServeoUrl = null;
let restarting = false;
let retryInterval = null;
let firstErrorReported = false;

async function announceToChannel(text) {
  try {
    if (!CHANNEL_ID) return;
    const ch = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (ch && ch.send) await ch.send(text);
  } catch (e) {
    console.error('Error anunciando a canal', e);
  }
}

function startServeo() {
  if (serveoProcess) return;
  console.log('Iniciando serveo (ssh -R 80:localhost:PORT serveo.net) ...');
  const args = ['-R', `80:localhost:${SERVEO_PORT}`, 'serveo.net'];
  serveoProcess = spawn(SSH_CMD, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  serveoProcess.stdout.on('data', (chunk) => {
    const s = String(chunk);
    process.stdout.write(`[serveo stdout] ${s}`);

    if (s.includes('Forwarding HTTP traffic from')) {
      currentServeoUrl = (s.match(/https?:\/\/[a-zA-Z0-9\.\-]+serveo\.net[^\s]*/i) || [null])[0];
      if (currentServeoUrl) {
        console.log('Serveo URL detectado:', currentServeoUrl);
        announceToChannel(`Serveo desplegado: ${currentServeoUrl}`);

        // Ya conectado, limpiar flag y reinicios automáticos
        firstErrorReported = false;
        if (retryInterval) {
          clearInterval(retryInterval);
          retryInterval = null;
        }
      }
    }
  });

  serveoProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[serveo stderr] ${String(chunk)}`);
  });

  serveoProcess.on('close', () => {
    console.log('Serveo cerrado. Relanzando en 3s...');
    serveoProcess = null;
    currentServeoUrl = null;
    if (!restarting) {
      restarting = true;
      setTimeout(() => {
        restarting = false;
        startServeo();
      }, 3000);
    }
  });

  serveoProcess.on('error', (err) => {
    console.error('Error en proceso serveo', err);

    // Solo reportar el primer error para evitar spam
    if (!firstErrorReported) {
      announceToChannel('La página está caída, en cualquier momento volverá');
      firstErrorReported = true;
    }

    serveoProcess = null;

    // Si no hay ya intervalo de reintento, iniciarlo
    if (!retryInterval) {
      retryInterval = setInterval(() => {
        console.log('Intentando reconectar serveo...');
        startServeo();
      }, 3600000); // 1 hora en ms
    }
  });
}

startServeo();
/* ====== LOGIN ====== */

client.login(process.env.DISCORD_TOKEN);

app.get('/.serveo-url', (req, res) => {
  res.json({ url: currentServeoUrl || null });
});

