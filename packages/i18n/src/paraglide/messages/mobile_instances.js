/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, host: NonNullable<unknown>, name: NonNullable<unknown> }} Mobile_InstancesInputs */



/**
* | part | output |
* | --- | --- |
* | "add_title" | "Add an instance" |
* | "add_intro" | "Brigade can sign you in to several instances at once and page you from each of them." |
* | "another" | "Another instance" |
* | "default_hint" | "The Brigade this app is set up for" |
* | "address_label" | "Address" |
* | "address_hint" | "The address of your company's Brigade dashboard, like brigade.example.com." |
* | "continue" | "Continue" |
* | "checking" | "Checking…" |
* | "scan" | "Scan a QR code" |
* | "scan_hint" | "On the dashboard, open Use the app." |
* | "invalid" | "Enter the address of a Brigade dashboard, like brigade.example.com." |
* | "insecure" | "Brigade only connects over HTTPS. Check that the address starts with https://." |
* | "not_brigade" | "This address is not a Brigade instance." |
* | "unreachable" | "Couldn't reach {host}. Check the address and your connection, then try again." |
* | "own_app_title" | "This instance uses its own app build" |
* | "own_app_body" | "{host} pages its members through its own app. This app could sign in there, but it would never be paged. Install your company's app from the dashboard's Use ..." |
* | "own_app_link" | "Get your company's app" |
* | "update_title" | "Update the app" |
* | "update_body" | "{host} needs a newer version of Brigade. Update the app, then try again." |
* | "no_relay" | "This instance cannot page this phone" |
* | "no_relay_body" | "You can sign in and follow incidents, but {host} has no push set up for this app, so this phone won't be paged." |
* | "signing_in_to" | "You are signing in to {host}" |
* | "already" | "You're already signed in to {host} on this phone." |
* | "open_instance" | "Open {host}" |
* | "sign_in_question" | "Sign in to {host}?" |
* | "sign_in_question_body" | "Continue only if you showed this code on {host}'s dashboard yourself, just now." |
* | "sign_in" | "Sign in" |
* | "claiming" | "Asking {host}…" |
* | "number_title" | "Type this number on the dashboard" |
* | "number_never_share" | "Never share this number. Nobody from Brigade or your company will ask you for it." |
* | "number_waiting" | "Waiting for you to type it on {host}'s dashboard…" |
* | "signed_in_as" | "Signed in to {host} as {name}" |
* | "ended_title" | "Not signed in" |
* | "ended_denied" | "The sign-in was denied on the dashboard." |
* | "ended_wrong_number" | "A different number was typed on the dashboard, so the sign-in ended. Show a new code to try again." |
* | "ended_timeout" | "The code expired. Show a new one on the dashboard and scan it again." |
* | "ended_delivered" | "This sign-in was already used. Show a new code to sign in." |
* | "ended_signed_out" | "The dashboard that showed the code signed out, so the sign-in ended." |
* | "ended_invalid_code" | "This code was already used or has expired. Show a new one on the dashboard." |
* | "ended_rate_limited" | "Too many tries from this network. Wait a minute, then scan again." |
* | "ended_unreachable" | "Couldn't reach {host}. Check your connection, then scan the code again." |
* | "ended_lost" | "{host} no longer knows this sign-in. Show a new code to try again." |
* | "ended_not_stored" | "The sign-in was approved, but this phone couldn't keep the session. Sign in with your password instead." |
* | "close" | "Close" |
* | "camera_needed" | "Brigade needs the camera to scan the QR code on the dashboard's Use the app page." |
* | "camera_allow" | "Allow the camera" |
* | "scan_not_brigade" | "This QR code isn't from Brigade. On the dashboard, open Use the app." |
* | "instances" | "Instances" |
* | "details" | "About this instance" |
* | "details_hint" | "Its address, its relay and whether it pages this phone" |
* | "relay_title" | "Pages" |
* | "relay_freecorps" | "Pages go through Freecorps' relay" |
* | "relay_own" | "Pages go through its own relay ({host})" |
* | "relay_none" | "No relay: this instance cannot page this phone" |
* | "relay_unknown" | "Couldn't check which relay it uses" |
* | "relay_default_raw" | "Pages come straight from this instance, which this app is set up for" |
* | "foreign_body" | "This instance uses its own app: install your company's app from its dashboard's Use the app page." |
* | "signed_in_as_row" | "Signed in as {name}" |
* | "signed_out" | "Signed out" |
* | "loading" | "Loading…" |
* | "paging_foreign" | "Not paged here: it uses its own app" |
* | "paging_no_relay" | "This instance cannot page this phone" |
* | "remove" | "Remove from this phone" |
* | "remove_title" | "Remove {host}?" |
* | "remove_body" | "You'll be signed out of {host} and this phone stops getting its pages. Your other instances stay as they are." |
* | "remove_body_signed_out" | "{host} leaves this phone. Your other instances stay as they are." |
* | "remove_on_call" | "You're on call there now ({name}). Make sure someone covers you before you go." |
* | "remove_on_call_unknown" | "If you're on call there, make sure someone covers you before you go." |
* | "remove_last" | "This is the only instance on this phone. To leave it, sign out instead." |
* | "removing" | "Removing…" |
* | "remove_kept" | "Couldn't reach {host}, so it may still page this phone. You're signed out here, and Brigade finishes signing you out there once it's back online. Remove it t..." |
* | "remove_failed" | "Couldn't remove {host}. Try again." |
* | "other_instances" | "Your other instances" |
* | "unnamed" | "Workspace" |
* | "open" | "Open" |
* | "current" | "Open now" |
* | "check_question" | "Connect to {host}?" |
* | "check_body" | "A link asked Brigade to connect to {host}. Brigade contacts it only if you continue. Continue only if you opened this link from your company's Brigade dashbo..." |
* | "sign_out_first" | "Sign out of it, then continue" |
* | "sign_out_first_hint" | "Signs you out of {host} on this phone first, as Sign out does, so it stops paging you here. Then this code signs you in." |
* | "ended_already" | "You're already signed in to {host} on this phone, so this sign-in wasn't used. It's listed in the account's sessions on the dashboard, where you can sign it ..." |
* | * | "Instances" |
*
* @param {Mobile_InstancesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const mobile_instances = /** @type {((inputs: Mobile_InstancesInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_InstancesInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "add_title") return /** @type {LocalizedString} */ (`Adicionar uma instância`);
		if (i?.part === "add_intro") return /** @type {LocalizedString} */ (`O Brigade pode conectar você a várias instâncias ao mesmo tempo e chamar você por cada uma delas.`);
		if (i?.part === "another") return /** @type {LocalizedString} */ (`Outra instância`);
		if (i?.part === "default_hint") return /** @type {LocalizedString} */ (`O Brigade para o qual este app está configurado`);
		if (i?.part === "address_label") return /** @type {LocalizedString} */ (`Endereço`);
		if (i?.part === "address_hint") return /** @type {LocalizedString} */ (`O endereço do painel do Brigade da sua empresa, como brigade.example.com.`);
		if (i?.part === "continue") return /** @type {LocalizedString} */ (`Continuar`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Verificando…`);
		if (i?.part === "scan") return /** @type {LocalizedString} */ (`Ler um QR code`);
		if (i?.part === "scan_hint") return /** @type {LocalizedString} */ (`No painel, abra Use o app.`);
		if (i?.part === "invalid") return /** @type {LocalizedString} */ (`Digite o endereço de um painel do Brigade, como brigade.example.com.`);
		if (i?.part === "insecure") return /** @type {LocalizedString} */ (`O Brigade só se conecta por HTTPS. Confira se o endereço começa com https://.`);
		if (i?.part === "not_brigade") return /** @type {LocalizedString} */ (`Este endereço não é uma instância do Brigade.`);
		if (i?.part === "unreachable") return /** @type {LocalizedString} */ (`Não foi possível acessar ${i?.host}. Confira o endereço e sua conexão e tente de novo.`);
		if (i?.part === "own_app_title") return /** @type {LocalizedString} */ (`Esta instância usa um app próprio`);
		if (i?.part === "own_app_body") return /** @type {LocalizedString} */ (`${i?.host} chama seus membros pelo app próprio dela. Este app conseguiria entrar, mas nunca receberia chamados. Instale o app da sua empresa pela página Use o app do painel.`);
		if (i?.part === "own_app_link") return /** @type {LocalizedString} */ (`Baixar o app da sua empresa`);
		if (i?.part === "update_title") return /** @type {LocalizedString} */ (`Atualize o app`);
		if (i?.part === "update_body") return /** @type {LocalizedString} */ (`${i?.host} precisa de uma versão mais nova do Brigade. Atualize o app e tente de novo.`);
		if (i?.part === "no_relay") return /** @type {LocalizedString} */ (`Esta instância não consegue chamar este telefone`);
		if (i?.part === "no_relay_body") return /** @type {LocalizedString} */ (`Você pode entrar e acompanhar incidentes, mas ${i?.host} não tem notificações configuradas para este app, então este telefone não vai receber chamados.`);
		if (i?.part === "signing_in_to") return /** @type {LocalizedString} */ (`Você está entrando em ${i?.host}`);
		if (i?.part === "already") return /** @type {LocalizedString} */ (`Você já está conectado a ${i?.host} neste telefone.`);
		if (i?.part === "open_instance") return /** @type {LocalizedString} */ (`Abrir ${i?.host}`);
		if (i?.part === "sign_in_question") return /** @type {LocalizedString} */ (`Entrar em ${i?.host}?`);
		if (i?.part === "sign_in_question_body") return /** @type {LocalizedString} */ (`Continue só se foi você quem mostrou este código no painel de ${i?.host} agora há pouco.`);
		if (i?.part === "sign_in") return /** @type {LocalizedString} */ (`Entrar`);
		if (i?.part === "claiming") return /** @type {LocalizedString} */ (`Consultando ${i?.host}…`);
		if (i?.part === "number_title") return /** @type {LocalizedString} */ (`Digite este número no painel`);
		if (i?.part === "number_never_share") return /** @type {LocalizedString} */ (`Nunca compartilhe este número. Ninguém do Brigade ou da sua empresa vai pedir por ele.`);
		if (i?.part === "number_waiting") return /** @type {LocalizedString} */ (`Aguardando você digitá-lo no painel de ${i?.host}…`);
		if (i?.part === "signed_in_as") return /** @type {LocalizedString} */ (`Conectado a ${i?.host} como ${i?.name}`);
		if (i?.part === "ended_title") return /** @type {LocalizedString} */ (`Não conectado`);
		if (i?.part === "ended_denied") return /** @type {LocalizedString} */ (`A entrada foi recusada no painel.`);
		if (i?.part === "ended_wrong_number") return /** @type {LocalizedString} */ (`Um número diferente foi digitado no painel, então a entrada foi encerrada. Mostre um novo código para tentar de novo.`);
		if (i?.part === "ended_timeout") return /** @type {LocalizedString} */ (`O código expirou. Mostre um novo no painel e leia de novo.`);
		if (i?.part === "ended_delivered") return /** @type {LocalizedString} */ (`Esta entrada já foi usada. Mostre um novo código para entrar.`);
		if (i?.part === "ended_signed_out") return /** @type {LocalizedString} */ (`O painel que mostrou o código saiu da conta, então a entrada foi encerrada.`);
		if (i?.part === "ended_invalid_code") return /** @type {LocalizedString} */ (`Este código já foi usado ou expirou. Mostre um novo no painel.`);
		if (i?.part === "ended_rate_limited") return /** @type {LocalizedString} */ (`Tentativas demais a partir desta rede. Aguarde um minuto e leia de novo.`);
		if (i?.part === "ended_unreachable") return /** @type {LocalizedString} */ (`Não foi possível acessar ${i?.host}. Confira sua conexão e leia o código de novo.`);
		if (i?.part === "ended_lost") return /** @type {LocalizedString} */ (`${i?.host} não reconhece mais esta entrada. Mostre um novo código para tentar de novo.`);
		if (i?.part === "ended_not_stored") return /** @type {LocalizedString} */ (`A entrada foi aprovada, mas este telefone não conseguiu guardar a sessão. Entre com sua senha.`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Fechar`);
		if (i?.part === "camera_needed") return /** @type {LocalizedString} */ (`O Brigade precisa da câmera para ler o QR code da página Use o app do painel.`);
		if (i?.part === "camera_allow") return /** @type {LocalizedString} */ (`Permitir a câmera`);
		if (i?.part === "scan_not_brigade") return /** @type {LocalizedString} */ (`Este QR code não é do Brigade. No painel, abra Use o app.`);
		if (i?.part === "instances") return /** @type {LocalizedString} */ (`Instâncias`);
		if (i?.part === "details") return /** @type {LocalizedString} */ (`Sobre esta instância`);
		if (i?.part === "details_hint") return /** @type {LocalizedString} */ (`Endereço, relay e se ela chama este telefone`);
		if (i?.part === "relay_title") return /** @type {LocalizedString} */ (`Chamados`);
		if (i?.part === "relay_freecorps") return /** @type {LocalizedString} */ (`Os chamados passam pelo relay da Freecorps`);
		if (i?.part === "relay_own") return /** @type {LocalizedString} */ (`Os chamados passam pelo relay próprio dela (${i?.host})`);
		if (i?.part === "relay_none") return /** @type {LocalizedString} */ (`Sem relay: esta instância não consegue chamar este telefone`);
		if (i?.part === "relay_unknown") return /** @type {LocalizedString} */ (`Não foi possível verificar qual relay ela usa`);
		if (i?.part === "relay_default_raw") return /** @type {LocalizedString} */ (`Os chamados vêm direto desta instância, para a qual este app está configurado`);
		if (i?.part === "foreign_body") return /** @type {LocalizedString} */ (`Esta instância usa um app próprio: instale o app da sua empresa pela página Use o app do painel dela.`);
		if (i?.part === "signed_in_as_row") return /** @type {LocalizedString} */ (`Conectado como ${i?.name}`);
		if (i?.part === "signed_out") return /** @type {LocalizedString} */ (`Desconectado`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Carregando…`);
		if (i?.part === "paging_foreign") return /** @type {LocalizedString} */ (`Sem chamados aqui: usa um app próprio`);
		if (i?.part === "paging_no_relay") return /** @type {LocalizedString} */ (`Esta instância não consegue chamar este telefone`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remover deste telefone`);
		if (i?.part === "remove_title") return /** @type {LocalizedString} */ (`Remover ${i?.host}?`);
		if (i?.part === "remove_body") return /** @type {LocalizedString} */ (`Você vai sair de ${i?.host} e este telefone deixa de receber os chamados dela. Suas outras instâncias continuam como estão.`);
		if (i?.part === "remove_body_signed_out") return /** @type {LocalizedString} */ (`${i?.host} sai deste telefone. Suas outras instâncias continuam como estão.`);
		if (i?.part === "remove_on_call") return /** @type {LocalizedString} */ (`Você está de plantão lá agora (${i?.name}). Garanta que alguém cubra você antes de sair.`);
		if (i?.part === "remove_on_call_unknown") return /** @type {LocalizedString} */ (`Se você estiver de plantão lá, garanta que alguém cubra você antes de sair.`);
		if (i?.part === "remove_last") return /** @type {LocalizedString} */ (`Esta é a única instância neste telefone. Para sair dela, use Sair.`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removendo…`);
		if (i?.part === "remove_kept") return /** @type {LocalizedString} */ (`Não foi possível acessar ${i?.host}, então ela ainda pode chamar este telefone. Você saiu aqui, e o Brigade conclui a saída lá assim que voltar a ficar online. Remova depois disso.`);
		if (i?.part === "remove_failed") return /** @type {LocalizedString} */ (`Não foi possível remover ${i?.host}. Tente de novo.`);
		if (i?.part === "other_instances") return /** @type {LocalizedString} */ (`Suas outras instâncias`);
		if (i?.part === "unnamed") return /** @type {LocalizedString} */ (`Espaço de trabalho`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Abrir`);
		if (i?.part === "current") return /** @type {LocalizedString} */ (`Aberta agora`);
		if (i?.part === "check_question") return /** @type {LocalizedString} */ (`Conectar a ${i?.host}?`);
		if (i?.part === "check_body") return /** @type {LocalizedString} */ (`Um link pediu ao Brigade para se conectar a ${i?.host}. O Brigade só entra em contato se você continuar. Continue só se você abriu este link pelo painel do Brigade da sua empresa.`);
		if (i?.part === "sign_out_first") return /** @type {LocalizedString} */ (`Sair dela e continuar`);
		if (i?.part === "sign_out_first_hint") return /** @type {LocalizedString} */ (`Primeiro tira você de ${i?.host} neste telefone, como Sair faz, para que ela deixe de chamar você aqui. Depois este código conecta você.`);
		if (i?.part === "ended_already") return /** @type {LocalizedString} */ (`Você já está conectado a ${i?.host} neste telefone, então esta entrada não foi usada. Ela aparece nas sessões da conta no painel, onde você pode encerrá-la.`);
		return /** @type {LocalizedString} */ (`Instâncias`)
	}
	{
		if (i?.part === "add_title") return /** @type {LocalizedString} */ (`Add an instance`);
		if (i?.part === "add_intro") return /** @type {LocalizedString} */ (`Brigade can sign you in to several instances at once and page you from each of them.`);
		if (i?.part === "another") return /** @type {LocalizedString} */ (`Another instance`);
		if (i?.part === "default_hint") return /** @type {LocalizedString} */ (`The Brigade this app is set up for`);
		if (i?.part === "address_label") return /** @type {LocalizedString} */ (`Address`);
		if (i?.part === "address_hint") return /** @type {LocalizedString} */ (`The address of your company's Brigade dashboard, like brigade.example.com.`);
		if (i?.part === "continue") return /** @type {LocalizedString} */ (`Continue`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Checking…`);
		if (i?.part === "scan") return /** @type {LocalizedString} */ (`Scan a QR code`);
		if (i?.part === "scan_hint") return /** @type {LocalizedString} */ (`On the dashboard, open Use the app.`);
		if (i?.part === "invalid") return /** @type {LocalizedString} */ (`Enter the address of a Brigade dashboard, like brigade.example.com.`);
		if (i?.part === "insecure") return /** @type {LocalizedString} */ (`Brigade only connects over HTTPS. Check that the address starts with https://.`);
		if (i?.part === "not_brigade") return /** @type {LocalizedString} */ (`This address is not a Brigade instance.`);
		if (i?.part === "unreachable") return /** @type {LocalizedString} */ (`Couldn't reach ${i?.host}. Check the address and your connection, then try again.`);
		if (i?.part === "own_app_title") return /** @type {LocalizedString} */ (`This instance uses its own app build`);
		if (i?.part === "own_app_body") return /** @type {LocalizedString} */ (`${i?.host} pages its members through its own app. This app could sign in there, but it would never be paged. Install your company's app from the dashboard's Use the app page.`);
		if (i?.part === "own_app_link") return /** @type {LocalizedString} */ (`Get your company's app`);
		if (i?.part === "update_title") return /** @type {LocalizedString} */ (`Update the app`);
		if (i?.part === "update_body") return /** @type {LocalizedString} */ (`${i?.host} needs a newer version of Brigade. Update the app, then try again.`);
		if (i?.part === "no_relay") return /** @type {LocalizedString} */ (`This instance cannot page this phone`);
		if (i?.part === "no_relay_body") return /** @type {LocalizedString} */ (`You can sign in and follow incidents, but ${i?.host} has no push set up for this app, so this phone won't be paged.`);
		if (i?.part === "signing_in_to") return /** @type {LocalizedString} */ (`You are signing in to ${i?.host}`);
		if (i?.part === "already") return /** @type {LocalizedString} */ (`You're already signed in to ${i?.host} on this phone.`);
		if (i?.part === "open_instance") return /** @type {LocalizedString} */ (`Open ${i?.host}`);
		if (i?.part === "sign_in_question") return /** @type {LocalizedString} */ (`Sign in to ${i?.host}?`);
		if (i?.part === "sign_in_question_body") return /** @type {LocalizedString} */ (`Continue only if you showed this code on ${i?.host}'s dashboard yourself, just now.`);
		if (i?.part === "sign_in") return /** @type {LocalizedString} */ (`Sign in`);
		if (i?.part === "claiming") return /** @type {LocalizedString} */ (`Asking ${i?.host}…`);
		if (i?.part === "number_title") return /** @type {LocalizedString} */ (`Type this number on the dashboard`);
		if (i?.part === "number_never_share") return /** @type {LocalizedString} */ (`Never share this number. Nobody from Brigade or your company will ask you for it.`);
		if (i?.part === "number_waiting") return /** @type {LocalizedString} */ (`Waiting for you to type it on ${i?.host}'s dashboard…`);
		if (i?.part === "signed_in_as") return /** @type {LocalizedString} */ (`Signed in to ${i?.host} as ${i?.name}`);
		if (i?.part === "ended_title") return /** @type {LocalizedString} */ (`Not signed in`);
		if (i?.part === "ended_denied") return /** @type {LocalizedString} */ (`The sign-in was denied on the dashboard.`);
		if (i?.part === "ended_wrong_number") return /** @type {LocalizedString} */ (`A different number was typed on the dashboard, so the sign-in ended. Show a new code to try again.`);
		if (i?.part === "ended_timeout") return /** @type {LocalizedString} */ (`The code expired. Show a new one on the dashboard and scan it again.`);
		if (i?.part === "ended_delivered") return /** @type {LocalizedString} */ (`This sign-in was already used. Show a new code to sign in.`);
		if (i?.part === "ended_signed_out") return /** @type {LocalizedString} */ (`The dashboard that showed the code signed out, so the sign-in ended.`);
		if (i?.part === "ended_invalid_code") return /** @type {LocalizedString} */ (`This code was already used or has expired. Show a new one on the dashboard.`);
		if (i?.part === "ended_rate_limited") return /** @type {LocalizedString} */ (`Too many tries from this network. Wait a minute, then scan again.`);
		if (i?.part === "ended_unreachable") return /** @type {LocalizedString} */ (`Couldn't reach ${i?.host}. Check your connection, then scan the code again.`);
		if (i?.part === "ended_lost") return /** @type {LocalizedString} */ (`${i?.host} no longer knows this sign-in. Show a new code to try again.`);
		if (i?.part === "ended_not_stored") return /** @type {LocalizedString} */ (`The sign-in was approved, but this phone couldn't keep the session. Sign in with your password instead.`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Close`);
		if (i?.part === "camera_needed") return /** @type {LocalizedString} */ (`Brigade needs the camera to scan the QR code on the dashboard's Use the app page.`);
		if (i?.part === "camera_allow") return /** @type {LocalizedString} */ (`Allow the camera`);
		if (i?.part === "scan_not_brigade") return /** @type {LocalizedString} */ (`This QR code isn't from Brigade. On the dashboard, open Use the app.`);
		if (i?.part === "instances") return /** @type {LocalizedString} */ (`Instances`);
		if (i?.part === "details") return /** @type {LocalizedString} */ (`About this instance`);
		if (i?.part === "details_hint") return /** @type {LocalizedString} */ (`Its address, its relay and whether it pages this phone`);
		if (i?.part === "relay_title") return /** @type {LocalizedString} */ (`Pages`);
		if (i?.part === "relay_freecorps") return /** @type {LocalizedString} */ (`Pages go through Freecorps' relay`);
		if (i?.part === "relay_own") return /** @type {LocalizedString} */ (`Pages go through its own relay (${i?.host})`);
		if (i?.part === "relay_none") return /** @type {LocalizedString} */ (`No relay: this instance cannot page this phone`);
		if (i?.part === "relay_unknown") return /** @type {LocalizedString} */ (`Couldn't check which relay it uses`);
		if (i?.part === "relay_default_raw") return /** @type {LocalizedString} */ (`Pages come straight from this instance, which this app is set up for`);
		if (i?.part === "foreign_body") return /** @type {LocalizedString} */ (`This instance uses its own app: install your company's app from its dashboard's Use the app page.`);
		if (i?.part === "signed_in_as_row") return /** @type {LocalizedString} */ (`Signed in as ${i?.name}`);
		if (i?.part === "signed_out") return /** @type {LocalizedString} */ (`Signed out`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Loading…`);
		if (i?.part === "paging_foreign") return /** @type {LocalizedString} */ (`Not paged here: it uses its own app`);
		if (i?.part === "paging_no_relay") return /** @type {LocalizedString} */ (`This instance cannot page this phone`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remove from this phone`);
		if (i?.part === "remove_title") return /** @type {LocalizedString} */ (`Remove ${i?.host}?`);
		if (i?.part === "remove_body") return /** @type {LocalizedString} */ (`You'll be signed out of ${i?.host} and this phone stops getting its pages. Your other instances stay as they are.`);
		if (i?.part === "remove_body_signed_out") return /** @type {LocalizedString} */ (`${i?.host} leaves this phone. Your other instances stay as they are.`);
		if (i?.part === "remove_on_call") return /** @type {LocalizedString} */ (`You're on call there now (${i?.name}). Make sure someone covers you before you go.`);
		if (i?.part === "remove_on_call_unknown") return /** @type {LocalizedString} */ (`If you're on call there, make sure someone covers you before you go.`);
		if (i?.part === "remove_last") return /** @type {LocalizedString} */ (`This is the only instance on this phone. To leave it, sign out instead.`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removing…`);
		if (i?.part === "remove_kept") return /** @type {LocalizedString} */ (`Couldn't reach ${i?.host}, so it may still page this phone. You're signed out here, and Brigade finishes signing you out there once it's back online. Remove it then.`);
		if (i?.part === "remove_failed") return /** @type {LocalizedString} */ (`Couldn't remove ${i?.host}. Try again.`);
		if (i?.part === "other_instances") return /** @type {LocalizedString} */ (`Your other instances`);
		if (i?.part === "unnamed") return /** @type {LocalizedString} */ (`Workspace`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Open`);
		if (i?.part === "current") return /** @type {LocalizedString} */ (`Open now`);
		if (i?.part === "check_question") return /** @type {LocalizedString} */ (`Connect to ${i?.host}?`);
		if (i?.part === "check_body") return /** @type {LocalizedString} */ (`A link asked Brigade to connect to ${i?.host}. Brigade contacts it only if you continue. Continue only if you opened this link from your company's Brigade dashboard.`);
		if (i?.part === "sign_out_first") return /** @type {LocalizedString} */ (`Sign out of it, then continue`);
		if (i?.part === "sign_out_first_hint") return /** @type {LocalizedString} */ (`Signs you out of ${i?.host} on this phone first, as Sign out does, so it stops paging you here. Then this code signs you in.`);
		if (i?.part === "ended_already") return /** @type {LocalizedString} */ (`You're already signed in to ${i?.host} on this phone, so this sign-in wasn't used. It's listed in the account's sessions on the dashboard, where you can sign it out.`);
		return /** @type {LocalizedString} */ (`Instances`)
	}
});