/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, host: NonNullable<unknown> }} Phones_PagesInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Phones and pages" |
* | "description" | "Which relay this instance sends pages to phones through, and whether its last check got through. Only owners and admins see this." |
* | "relay_label" | "Relay" |
* | "relay_freecorps" | "Pages go through Freecorps' relay" |
* | "relay_own" | "Pages go through your company's own relay" |
* | "relay_own_host" | "Pages go through your company's own relay ({host})" |
* | "relay_none" | "No relay: phones aren't paged" |
* | "relay_unknown" | "Couldn't tell which relay pages go through." |
* | "freecorps_hint" | "It pages the Brigade app from the App Store and Google Play." |
* | "own_hint" | "It pages only your company's own build of the Brigade app: the Brigade app in the stores can't get its pages." |
* | "none_hint" | "No push relay is set up, so phones get no pages. Pages still go out by email when this instance can send email. To page phones, set up a relay from the machi..." |
* | "state_label" | "State" |
* | "app_label" | "App to install" |
* | "app_none" | "No link to your company's app is set, so members aren't told where to get it. Add one (RELAY_APP_URL) when you run setup again:" |
* | "checking" | "Checking…" |
* | "state_working" | "Working" |
* | "hint_working" | "The last check reached the relay and it answered." |
* | "state_not_checked" | "Not checked yet" |
* | "hint_not_checked" | "The paging self-check runs every minute once the instance is deployed, and it hasn't run yet." |
* | "state_unregistered" | "Not registered" |
* | "hint_unregistered_freecorps" | "This instance isn't registered on Freecorps' relay, or its registration wasn't finished (it needs the code emailed to your contact). Run:" |
* | "hint_unregistered_own" | "This instance isn't registered on your relay. Run setup again:" |
* | "state_refused" | "Refused" |
* | "hint_bad_signature" | "The relay doesn't accept this instance's key, or this server's clock is more than 5 minutes off. Check that RELAY_INSTANCE_KEY is the key you saved and, afte..." |
* | "hint_revoked_freecorps" | "Freecorps revoked this instance on its relay. Write to Freecorps to find out why before you register again." |
* | "hint_revoked_own" | "This instance was revoked on your relay. Register it again:" |
* | "hint_unauthorized_freecorps" | "The relay refused the send token (RELAY_SEND_TOKEN), so phones registered before relay handles aren't paged. Set the same RELAY_SEND_TOKEN on the relay and o..." |
* | "hint_unauthorized_own" | "The relay refused the send token (RELAY_SEND_TOKEN), so phones registered before relay handles aren't paged. Run setup again to set a matching token:" |
* | "state_unreachable" | "Unreachable" |
* | "hint_unreachable_freecorps" | "Freecorps' relay isn't answering. Check RELAY_URL on the API; if it's right, the relay may be down, and pages go out by email meanwhile." |
* | "hint_unreachable_own" | "Your relay isn't answering. Check that it's deployed and that the API reaches it (the RELAY binding, or RELAY_URL)." |
* | "state_rate_limited" | "Rate limited" |
* | "hint_rate_limited" | "The relay keeps refusing this instance's checks as over its limits. It usually clears on its own; if it lasts, ask whoever runs the relay to raise the limit." |
* | "state_handles_unavailable" | "Handles unavailable" |
* | "hint_handles_freecorps" | "The relay can't open phone handles right now, so phones registered with a relay handle aren't paged through it. If it lasts, write to Freecorps." |
* | "hint_handles_own" | "Your relay can't open phone handles. Deploy the current apps/relay and check its RELAY_HANDLE_KEYS; running setup again keeps the keys it has:" |
* | "state_providers" | "Push service failing" |
* | "hint_providers_freecorps" | "Apple's or Google's push service refused the relay's credentials, or isn't answering. That's on the relay's side: nothing to change on this instance." |
* | "hint_providers_own" | "Apple's or Google's push service refused your relay's credentials, or isn't answering. If you changed the APNs key or the Firebase account, replace them:" |
* | "state_pipeline" | "Held up in Brigade" |
* | "state_database" | "Database not answering" |
* | "hint_database" | "The database (D1) didn't answer a simple read in the last checks. Look at the API's logs; if it lasts, check Cloudflare's status." |
* | "hint_unknown_relay" | "Brigade didn't say which relay this is, so it can't say what to do here. The paging notice on the overview names the reason." |
* | "hint_pipeline" | "Pages are held up before they reach the relay, so it can't be checked. The paging notice on the overview says why." |
* | "state_no_answer" | "Couldn't check" |
* | "hint_no_answer" | "Brigade didn't answer the paging check. It tries again every minute." |
* | "hint_no_details" | "Brigade answered the paging check without saying why it isn't working: your session may have expired. Reload the page, and sign in again if it asks." |
* | * | "Phones and pages" |
*
* @param {Phones_PagesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const phones_pages = /** @type {((inputs: Phones_PagesInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Phones_PagesInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Celulares e acionamentos`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Por qual relay esta instância envia acionamentos aos celulares, e se a última verificação passou. Só owners e admins veem isto.`);
		if (i?.part === "relay_label") return /** @type {LocalizedString} */ (`Relay`);
		if (i?.part === "relay_freecorps") return /** @type {LocalizedString} */ (`Os acionamentos passam pelo relay da Freecorps`);
		if (i?.part === "relay_own") return /** @type {LocalizedString} */ (`Os acionamentos passam pelo relay próprio da sua empresa`);
		if (i?.part === "relay_own_host") return /** @type {LocalizedString} */ (`Os acionamentos passam pelo relay próprio da sua empresa (${i?.host})`);
		if (i?.part === "relay_none") return /** @type {LocalizedString} */ (`Sem relay: celulares não são acionados`);
		if (i?.part === "relay_unknown") return /** @type {LocalizedString} */ (`Não foi possível saber por qual relay os acionamentos passam.`);
		if (i?.part === "freecorps_hint") return /** @type {LocalizedString} */ (`Ele aciona o app do Brigade da App Store e do Google Play.`);
		if (i?.part === "own_hint") return /** @type {LocalizedString} */ (`Ele aciona só a versão própria da sua empresa do app do Brigade: o app do Brigade nas lojas não recebe os acionamentos dele.`);
		if (i?.part === "none_hint") return /** @type {LocalizedString} */ (`Nenhum relay de push está configurado, então os celulares não recebem acionamentos. Eles continuam saindo por email quando esta instância consegue enviar email. Para acionar celulares, configure um relay na máquina de onde você faz o deploy:`);
		if (i?.part === "state_label") return /** @type {LocalizedString} */ (`Estado`);
		if (i?.part === "app_label") return /** @type {LocalizedString} */ (`App para instalar`);
		if (i?.part === "app_none") return /** @type {LocalizedString} */ (`Nenhum link para o app da sua empresa está configurado, então os membros não ficam sabendo onde baixá-lo. Adicione um (RELAY_APP_URL) ao rodar a configuração de novo:`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Verificando…`);
		if (i?.part === "state_working") return /** @type {LocalizedString} */ (`Funcionando`);
		if (i?.part === "hint_working") return /** @type {LocalizedString} */ (`A última verificação chegou ao relay e ele respondeu.`);
		if (i?.part === "state_not_checked") return /** @type {LocalizedString} */ (`Ainda não verificado`);
		if (i?.part === "hint_not_checked") return /** @type {LocalizedString} */ (`A autoverificação dos acionamentos roda a cada minuto depois que a instância está no ar, e ainda não rodou.`);
		if (i?.part === "state_unregistered") return /** @type {LocalizedString} */ (`Não registrada`);
		if (i?.part === "hint_unregistered_freecorps") return /** @type {LocalizedString} */ (`Esta instância não está registrada no relay da Freecorps, ou o registro não foi concluído (ele pede o código enviado por email ao seu contato). Rode:`);
		if (i?.part === "hint_unregistered_own") return /** @type {LocalizedString} */ (`Esta instância não está registrada no seu relay. Rode a configuração de novo:`);
		if (i?.part === "state_refused") return /** @type {LocalizedString} */ (`Recusado`);
		if (i?.part === "hint_bad_signature") return /** @type {LocalizedString} */ (`O relay não aceita a chave desta instância, ou o relógio deste servidor está mais de 5 minutos fora. Confira se o RELAY_INSTANCE_KEY é a chave que você guardou e, depois de uma rotação de chave, se o RELAY_INSTANCE_ID é o primeiro id da instância. Não configure o relay de novo por isso: isso cria um novo id de instância, e todo celular teria de abrir o app de novo.`);
		if (i?.part === "hint_revoked_freecorps") return /** @type {LocalizedString} */ (`A Freecorps revogou esta instância no relay dela. Escreva para a Freecorps para saber o motivo antes de registrar de novo.`);
		if (i?.part === "hint_revoked_own") return /** @type {LocalizedString} */ (`Esta instância foi revogada no seu relay. Registre-a de novo:`);
		if (i?.part === "hint_unauthorized_freecorps") return /** @type {LocalizedString} */ (`O relay recusou o token de envio (RELAY_SEND_TOKEN), então celulares registrados antes dos identificadores do relay não são acionados. Defina o mesmo RELAY_SEND_TOKEN no relay e na API.`);
		if (i?.part === "hint_unauthorized_own") return /** @type {LocalizedString} */ (`O relay recusou o token de envio (RELAY_SEND_TOKEN), então celulares registrados antes dos identificadores do relay não são acionados. Rode a configuração de novo para definir um token igual nos dois:`);
		if (i?.part === "state_unreachable") return /** @type {LocalizedString} */ (`Inacessível`);
		if (i?.part === "hint_unreachable_freecorps") return /** @type {LocalizedString} */ (`O relay da Freecorps não está respondendo. Confira o RELAY_URL na API; se estiver certo, o relay pode estar fora do ar, e enquanto isso os acionamentos saem por email.`);
		if (i?.part === "hint_unreachable_own") return /** @type {LocalizedString} */ (`Seu relay não está respondendo. Confira se ele está no ar e se a API chega até ele (o binding RELAY, ou o RELAY_URL).`);
		if (i?.part === "state_rate_limited") return /** @type {LocalizedString} */ (`Limite atingido`);
		if (i?.part === "hint_rate_limited") return /** @type {LocalizedString} */ (`O relay continua recusando as verificações desta instância por passarem dos limites dele. Isso costuma passar sozinho; se durar, peça a quem cuida do relay para aumentar o limite.`);
		if (i?.part === "state_handles_unavailable") return /** @type {LocalizedString} */ (`Identificadores indisponíveis`);
		if (i?.part === "hint_handles_freecorps") return /** @type {LocalizedString} */ (`O relay não consegue abrir os identificadores dos celulares agora, então os celulares registrados com um identificador do relay não são acionados por ele. Se durar, escreva para a Freecorps.`);
		if (i?.part === "hint_handles_own") return /** @type {LocalizedString} */ (`Seu relay não consegue abrir os identificadores dos celulares. Faça o deploy do apps/relay atual e confira o RELAY_HANDLE_KEYS dele; rodar a configuração de novo mantém as chaves que ele já tem:`);
		if (i?.part === "state_providers") return /** @type {LocalizedString} */ (`Serviço de push falhando`);
		if (i?.part === "hint_providers_freecorps") return /** @type {LocalizedString} */ (`O serviço de push da Apple ou do Google recusou as credenciais do relay, ou não está respondendo. Isso é do lado do relay: nada a mudar nesta instância.`);
		if (i?.part === "hint_providers_own") return /** @type {LocalizedString} */ (`O serviço de push da Apple ou do Google recusou as credenciais do seu relay, ou não está respondendo. Se você trocou a chave do APNs ou a conta do Firebase, substitua-as:`);
		if (i?.part === "state_pipeline") return /** @type {LocalizedString} */ (`Parado no Brigade`);
		if (i?.part === "state_database") return /** @type {LocalizedString} */ (`Banco de dados sem resposta`);
		if (i?.part === "hint_database") return /** @type {LocalizedString} */ (`O banco de dados (D1) não respondeu a uma leitura simples nas últimas verificações. Veja os logs da API; se durar, confira o status da Cloudflare.`);
		if (i?.part === "hint_unknown_relay") return /** @type {LocalizedString} */ (`O Brigade não disse qual é o relay, então não dá para dizer o que fazer aqui. O aviso de acionamentos na visão geral diz o motivo.`);
		if (i?.part === "hint_pipeline") return /** @type {LocalizedString} */ (`Os acionamentos estão parados antes de chegar ao relay, então ele não pode ser verificado. O aviso de acionamentos na visão geral diz o motivo.`);
		if (i?.part === "state_no_answer") return /** @type {LocalizedString} */ (`Não foi possível verificar`);
		if (i?.part === "hint_no_answer") return /** @type {LocalizedString} */ (`O Brigade não respondeu à verificação dos acionamentos. Ele tenta de novo a cada minuto.`);
		if (i?.part === "hint_no_details") return /** @type {LocalizedString} */ (`O Brigade respondeu à verificação dos acionamentos sem dizer por que não está funcionando: sua sessão pode ter expirado. Recarregue a página e entre de novo se ela pedir.`);
		return /** @type {LocalizedString} */ (`Celulares e acionamentos`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Phones and pages`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Which relay this instance sends pages to phones through, and whether its last check got through. Only owners and admins see this.`);
		if (i?.part === "relay_label") return /** @type {LocalizedString} */ (`Relay`);
		if (i?.part === "relay_freecorps") return /** @type {LocalizedString} */ (`Pages go through Freecorps' relay`);
		if (i?.part === "relay_own") return /** @type {LocalizedString} */ (`Pages go through your company's own relay`);
		if (i?.part === "relay_own_host") return /** @type {LocalizedString} */ (`Pages go through your company's own relay (${i?.host})`);
		if (i?.part === "relay_none") return /** @type {LocalizedString} */ (`No relay: phones aren't paged`);
		if (i?.part === "relay_unknown") return /** @type {LocalizedString} */ (`Couldn't tell which relay pages go through.`);
		if (i?.part === "freecorps_hint") return /** @type {LocalizedString} */ (`It pages the Brigade app from the App Store and Google Play.`);
		if (i?.part === "own_hint") return /** @type {LocalizedString} */ (`It pages only your company's own build of the Brigade app: the Brigade app in the stores can't get its pages.`);
		if (i?.part === "none_hint") return /** @type {LocalizedString} */ (`No push relay is set up, so phones get no pages. Pages still go out by email when this instance can send email. To page phones, set up a relay from the machine you deploy from:`);
		if (i?.part === "state_label") return /** @type {LocalizedString} */ (`State`);
		if (i?.part === "app_label") return /** @type {LocalizedString} */ (`App to install`);
		if (i?.part === "app_none") return /** @type {LocalizedString} */ (`No link to your company's app is set, so members aren't told where to get it. Add one (RELAY_APP_URL) when you run setup again:`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Checking…`);
		if (i?.part === "state_working") return /** @type {LocalizedString} */ (`Working`);
		if (i?.part === "hint_working") return /** @type {LocalizedString} */ (`The last check reached the relay and it answered.`);
		if (i?.part === "state_not_checked") return /** @type {LocalizedString} */ (`Not checked yet`);
		if (i?.part === "hint_not_checked") return /** @type {LocalizedString} */ (`The paging self-check runs every minute once the instance is deployed, and it hasn't run yet.`);
		if (i?.part === "state_unregistered") return /** @type {LocalizedString} */ (`Not registered`);
		if (i?.part === "hint_unregistered_freecorps") return /** @type {LocalizedString} */ (`This instance isn't registered on Freecorps' relay, or its registration wasn't finished (it needs the code emailed to your contact). Run:`);
		if (i?.part === "hint_unregistered_own") return /** @type {LocalizedString} */ (`This instance isn't registered on your relay. Run setup again:`);
		if (i?.part === "state_refused") return /** @type {LocalizedString} */ (`Refused`);
		if (i?.part === "hint_bad_signature") return /** @type {LocalizedString} */ (`The relay doesn't accept this instance's key, or this server's clock is more than 5 minutes off. Check that RELAY_INSTANCE_KEY is the key you saved and, after a key rotation, that RELAY_INSTANCE_ID is the instance's first id. Don't set the relay up again for this: it makes a new instance id, and every phone would have to open the app again.`);
		if (i?.part === "hint_revoked_freecorps") return /** @type {LocalizedString} */ (`Freecorps revoked this instance on its relay. Write to Freecorps to find out why before you register again.`);
		if (i?.part === "hint_revoked_own") return /** @type {LocalizedString} */ (`This instance was revoked on your relay. Register it again:`);
		if (i?.part === "hint_unauthorized_freecorps") return /** @type {LocalizedString} */ (`The relay refused the send token (RELAY_SEND_TOKEN), so phones registered before relay handles aren't paged. Set the same RELAY_SEND_TOKEN on the relay and on the API.`);
		if (i?.part === "hint_unauthorized_own") return /** @type {LocalizedString} */ (`The relay refused the send token (RELAY_SEND_TOKEN), so phones registered before relay handles aren't paged. Run setup again to set a matching token:`);
		if (i?.part === "state_unreachable") return /** @type {LocalizedString} */ (`Unreachable`);
		if (i?.part === "hint_unreachable_freecorps") return /** @type {LocalizedString} */ (`Freecorps' relay isn't answering. Check RELAY_URL on the API; if it's right, the relay may be down, and pages go out by email meanwhile.`);
		if (i?.part === "hint_unreachable_own") return /** @type {LocalizedString} */ (`Your relay isn't answering. Check that it's deployed and that the API reaches it (the RELAY binding, or RELAY_URL).`);
		if (i?.part === "state_rate_limited") return /** @type {LocalizedString} */ (`Rate limited`);
		if (i?.part === "hint_rate_limited") return /** @type {LocalizedString} */ (`The relay keeps refusing this instance's checks as over its limits. It usually clears on its own; if it lasts, ask whoever runs the relay to raise the limit.`);
		if (i?.part === "state_handles_unavailable") return /** @type {LocalizedString} */ (`Handles unavailable`);
		if (i?.part === "hint_handles_freecorps") return /** @type {LocalizedString} */ (`The relay can't open phone handles right now, so phones registered with a relay handle aren't paged through it. If it lasts, write to Freecorps.`);
		if (i?.part === "hint_handles_own") return /** @type {LocalizedString} */ (`Your relay can't open phone handles. Deploy the current apps/relay and check its RELAY_HANDLE_KEYS; running setup again keeps the keys it has:`);
		if (i?.part === "state_providers") return /** @type {LocalizedString} */ (`Push service failing`);
		if (i?.part === "hint_providers_freecorps") return /** @type {LocalizedString} */ (`Apple's or Google's push service refused the relay's credentials, or isn't answering. That's on the relay's side: nothing to change on this instance.`);
		if (i?.part === "hint_providers_own") return /** @type {LocalizedString} */ (`Apple's or Google's push service refused your relay's credentials, or isn't answering. If you changed the APNs key or the Firebase account, replace them:`);
		if (i?.part === "state_pipeline") return /** @type {LocalizedString} */ (`Held up in Brigade`);
		if (i?.part === "state_database") return /** @type {LocalizedString} */ (`Database not answering`);
		if (i?.part === "hint_database") return /** @type {LocalizedString} */ (`The database (D1) didn't answer a simple read in the last checks. Look at the API's logs; if it lasts, check Cloudflare's status.`);
		if (i?.part === "hint_unknown_relay") return /** @type {LocalizedString} */ (`Brigade didn't say which relay this is, so it can't say what to do here. The paging notice on the overview names the reason.`);
		if (i?.part === "hint_pipeline") return /** @type {LocalizedString} */ (`Pages are held up before they reach the relay, so it can't be checked. The paging notice on the overview says why.`);
		if (i?.part === "state_no_answer") return /** @type {LocalizedString} */ (`Couldn't check`);
		if (i?.part === "hint_no_answer") return /** @type {LocalizedString} */ (`Brigade didn't answer the paging check. It tries again every minute.`);
		if (i?.part === "hint_no_details") return /** @type {LocalizedString} */ (`Brigade answered the paging check without saying why it isn't working: your session may have expired. Reload the page, and sign in again if it asks.`);
		return /** @type {LocalizedString} */ (`Phones and pages`)
	}
});