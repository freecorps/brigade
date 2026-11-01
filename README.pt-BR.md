# Freecorps Brigade

**Gestão de incidentes open source que roda na sua conta Cloudflare.**
Monitores, alertas, plantão, incidentes, Slack e apps mobile nativos — sem cobrança por usuário.

> 🚧 **Fase inicial de design.** Ainda não há nada utilizável. Leia os planos em [`docs/`](docs/) e participe da discussão.

[English](README.md)

## O que vai fazer

- **Monitores** em várias regiões, com alerta por quórum
- **Alertas** dos seus monitores e de ferramentas como Grafana, Datadog e Sentry, deduplicados e roteados
- **Incidentes** com severidade, status, papéis, campos customizados e timeline ao vivo
- **Plantão** com escalas, trocas e políticas de escalonamento
- **Apps mobile** (iOS/Android) com notificação de plantão de verdade e ack direto da tela de bloqueio
- **Slack** pra declarar e conduzir incidentes onde o time já conversa
- **Status pages** e **postmortems** (com rascunho gerado por IA)
- **Sync em tempo real** entre web e mobile
- **Internacionalizado** desde o início (English, Português)

## Documentação

Os documentos de design estão em inglês, em [`docs/`](docs/). Comece pela [visão e escopo](docs/rfcs/0001-vision-and-scope.md),
o [roadmap](docs/roadmap.md) e as [questões em aberto](docs/open-questions.md).

Para quem hospeda o Brigade (em inglês): [Page your team with the Brigade app](docs/self-hosting/phones.md), que
pagina os celulares pelo relay da Freecorps e o app das lojas, e [Run your own app and relay](docs/self-hosting/own-app.md).

## Licença

As aplicações são licenciadas sob [AGPL-3.0](LICENSE). Os pacotes em `packages/` são MIT.

"Freecorps" e "Freecorps Brigade" são marcas da Freecorps Tecnologia da Informação LTDA.
