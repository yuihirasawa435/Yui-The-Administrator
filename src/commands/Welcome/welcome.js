import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../../utils/database.js';
import { formatWelcomeMessage, truncateForEmbedField } from '../../utils/welcome.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ErrorTypes, replyUserError } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Configure the welcome system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set up the welcome message')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The channel to send welcome messages to')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Welcome message. Variables: {user}, {username}, {server}, {memberCount}')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('image')
                        .setDescription('URL of the image to include in the welcome message')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ping')
                        .setDescription('Whether to ping the user in the welcome message')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Enable or disable the welcome system directly')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('Turn the welcome system on or off')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Set to true to enable, or false to disable')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);
            if (!deferSuccess) {
                logger.warn(`Welcome interaction defer failed`, {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'welcome'
                });
                return;
            }
        } catch (deferError) {
            logger.error(`Welcome defer error`, { error: deferError.message });
            return;
        }

        const { options, guild, client } = interaction;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, { 
                type: ErrorTypes.PERMISSION, 
                message: 'You need the **Manage Server** permission to use `/welcome`.' 
            });
        }

        const subcommand = options.getSubcommand();

        if (subcommand === 'toggle') {
            const isEnabled = options.getBoolean('enabled');
            const existingConfig = await getWelcomeConfig(client, guild.id);

            if (!existingConfig?.channelId) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Welcome system has not been configured yet. Please run `/welcome setup` first.'
                });
            }

            try {
                await updateWelcomeConfig(client, guild.id, {
                    ...existingConfig,
                    enabled: isEnabled
                });

                logger.info(`[Welcome] Toggled to ${isEnabled} by ${interaction.user.tag} in ${guild.name} (${guild.id})`);

                const embed = new EmbedBuilder()
                    .setColor(isEnabled ? getColor('success') : getColor('error'))
                    .setTitle('Welcome System Status Updated')
                    .setDescription(`The welcome system is now **${isEnabled ? 'Enabled' : 'Disabled'}**.`)
                    .setFooter({ text: 'Tip: Use /greet dashboard to view all configurations' });

                return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } catch (error) {
                logger.error(`[Welcome] Failed to toggle welcome status for guild ${guild.id}:`, error);
                return await replyUserError(interaction, {
                    type: ErrorTypes.UNKNOWN,
                    message: 'An error occurred while updating the welcome system status.'
                });
            }
        }

        if (subcommand === 'setup') {
            const channel = options.getChannel('channel');
            const message = options.getString('message');
            const image = options.getString('image');
            const ping = options.getBoolean('ping') ?? false;
            const enabled = options.getBoolean('enabled') ?? true;

            const existingConfig = await getWelcomeConfig(client, guild.id);
            if (existingConfig?.channelId) {
                logger.info(`[Welcome] Setup blocked because config already exists in channel ${existingConfig.channelId} for guild ${guild.id}`);
                return await replyUserError(interaction, { 
                    type: ErrorTypes.UNKNOWN, 
                    message: `Welcome is already configured for <#${existingConfig.channelId}>. Use **/greet dashboard** to customize channel, message, ping, or image.` 
                });
            }
            
            if (!message || message.trim().length === 0) {
                logger.warn(`[Welcome] Empty message provided by ${interaction.user.tag} in ${guild.name}`);
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Welcome message cannot be empty' });
            }

            if (image) {
                try {
                    new URL(image);
                } catch (e) {
                    logger.warn(`[Welcome] Invalid image URL provided by ${interaction.user.tag}: ${image}`);
                    return await replyUserError(interaction, { 
                        type: ErrorTypes.VALIDATION, 
                        message: 'Please provide a valid image URL (must start with http:// or https://)' 
                    });
                }
            }

            try {
                await updateWelcomeConfig(client, guild.id, {
                    enabled,
                    channelId: channel.id,
                    welcomeMessage: message,
                    welcomeImage: image || undefined,
                    welcomePing: ping
                });

                logger.info(`[Welcome] Setup configured by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

                const previewMessage = formatWelcomeMessage(message, {
                    user: interaction.user,
                    guild
                });

                const embed = new EmbedBuilder()
                    .setColor(getColor('success'))
                    .setTitle('Welcome System Configured')
                    .setDescription(`Welcome messages will now be sent to ${channel}`)
                    .addFields(
                        { name: 'Message Preview', value: truncateForEmbedField(previewMessage) },
                        { name: 'Ping User', value: ping ? 'Yes' : 'No' },
                        { name: 'Status', value: enabled ? 'Enabled' : 'Disabled' }
                    )
                    .setFooter({ text: 'Tip: Use /greet dashboard to customize welcome settings' });

                if (image) {
                    embed.setImage(image);
                }

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } catch (error) {
                logger.error(`[Welcome] Failed to setup welcome system for guild ${guild.id}:`, error);
                await replyUserError(interaction, { 
                    type: ErrorTypes.UNKNOWN, 
                    message: 'An error occurred while configuring the welcome system. Please try again.' 
                });
            }
        }
    },
};
