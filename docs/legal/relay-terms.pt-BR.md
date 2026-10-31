> **Template — versão prévia, sem validade.**
> Este é um rascunho dos termos do relay de push hospedado pela Freecorps, escrito para que instâncias self-hosted
> tenham algo para ler e para onde apontar enquanto o relay é construído. Ainda não foi revisado por advogado, não
> obriga ninguém e será substituído pelo texto final (no site do projeto) antes de qualquer instância ser orientada a
> usar o relay hospedado. As partes entre colchetes (`[…]`) ainda serão preenchidas: o email de contato do relay, a política de privacidade e a página de status. Versão: `draft-2026-11`.
>
> English: [relay-terms.md](relay-terms.md). Em caso de divergência, vale a versão em inglês até o texto final.

# Termos de uso do relay de push do Brigade

Estes termos tratam do relay de push que a Freecorps Tecnologia da Informação LTDA, sociedade limitada brasileira (CNPJ 63.113.119/0001-90) ("Freecorps", "nós"), opera para instâncias do
Brigade ("o relay"). Valem para quem opera uma instância e a registra no relay ("você"). O software Brigade tem suas
próprias licenças open source (AGPL-3.0 e MIT); estes termos tratam só do serviço.

## 1. O que o relay faz

A Apple (APNs) e o Google (FCM) só entregam notificações de quem publicou o app. O relay permite que uma instância
sua pagine o app do Brigade da App Store e do Google Play: sua instância envia uma notificação cifrada e um handle
opaco, e o relay a repassa para a Apple ou o Google.

O relay não consegue ler suas notificações. Elas são cifradas na sua instância para cada celular e abertas só nele
(RFC 0006). O relay vê o handle, o texto cifrado, a urgência e o horário.

## 2. Registro

- Para usar o relay, você registra sua instância, aceita estes termos e informa um email de contato, confirmado por
  um código. Escrevemos para esse email sobre o seu uso do relay, inclusive antes de limitá-lo ou suspendê-lo.
- A chave da instância é a credencial dela. Guarde-a bem: quem a tiver envia como a sua instância, e se ela se perder
  todo celular precisa abrir o app de novo antes de voltar a ser paginado.
- Um registro por instância. Você responde pelo que é enviado com a chave da sua instância.

## 3. Preço e uso justo

O relay é gratuito para qualquer instância registrada dentro destes limites, bem acima do que um time de verdade
pagina:

- 600 notificações por minuto por instância, das quais no máximo 60 chamadas;
- 30 notificações por minuto para um mesmo celular.

Podemos aumentá-los sob pedido. O que passar deles é recusado (`429`), não cobrado.

## 4. O que você não pode fazer

- Enviar algo que não seja sobre incidentes, alertas, plantão do seu time ou o estado do próprio app: nada de
  marketing, mensagens em massa ou notificações para terceiros.
- Enviar chamadas (pushes VoIP) ou Critical Alerts para algo menos urgente que uma página.
- Tentar alcançar celulares que não fizeram login na sua instância, ler o tráfego de outras instâncias ou contornar
  os limites (por exemplo, com vários registros).
- Revender o relay ou montar um serviço pago sobre ele sem um acordo por escrito com a Freecorps.
- Usá-lo contra a lei ou contra as regras da Apple ou do Google para notificações push.

Quebrar essas regras pode fazer a Apple ou o Google estrangularem o app inteiro, para todo usuário do Brigade. Por
isso agimos sobre elas (seção 7).

## 5. O que vemos e guardamos

- **Da sua instância:** o id e a chave pública, a versão dos termos aceita, o email de contato e a contagem do que
  ela enviou (por minuto, guardada por 30 dias).
- **Dos celulares:** quando um celular pede um handle, o token de push dele (selado dentro do handle, nunca guardado
  à parte por nós) e o endereço IP (em logs guardados por 7 dias).
- **Das notificações:** o handle, a urgência, o horário e a resposta da Apple ou do Google, em logs guardados por
  7 dias. Nunca o conteúdo, que não conseguimos ler.

Não vendemos nada disso nem usamos para publicidade. Usamos para operar o relay, fazer valer estes termos e atender
pedidos legais. [Política de privacidade da Freecorps e contato do encarregado de dados, LGPD.]

## 6. Disponibilidade

Operamos o relay com cuidado, mas **não garantimos** que ele esteja disponível nem que qualquer notificação chegue: a
Apple, o Google, a rede e o celular estão todos no caminho. Não faça dele a única forma de alcançar o seu time. Uma
instância do Brigade também pagina por email, e você pode operar o seu próprio relay com o seu próprio build do app
(a documentação de self-host explica como).

Avisamos os contatos registrados antes de manutenções planejadas que possam atrasar notificações, e mantemos uma
página de status em [endereço].

## 7. Limitação, suspensão e encerramento

- Podemos limitar ou suspender uma instância que quebre a seção 4 ou ponha o relay ou o app em risco. Salvo quando o
  dano está em curso, escrevemos antes para o email de contato e damos 7 dias para corrigir.
- Você pode deixar de usar o relay a qualquer momento; peça pelo contato (seção 11) para apagarmos o seu registro.
- Podemos deixar de oferecer o relay com 90 dias de aviso a todos os contatos registrados.

## 8. Mudanças nestes termos

Publicamos cada nova versão com a data. Para mudanças que reduzam o que você recebe ou criem obrigações, escrevemos
para o email de contato 30 dias antes de valerem; usar o relay depois disso significa aceitá-las.

## 9. Responsabilidade

O relay é oferecido no estado em que se encontra, gratuitamente. Na medida em que a lei permitir, a Freecorps não
responde por notificações atrasadas, perdidas ou não enviadas, nem pelo que decorra delas, inclusive lucros
cessantes, receita, reputação, oportunidades de negócio ou dados. Quando a responsabilidade não puder ser excluída,
ela não passará de R$ 100 no total, para todas as reclamações dos 12 meses anteriores ao fato que as originou.

## 10. Lei aplicável e disputas

Estes termos são regidos pelas leis da República Federativa do Brasil e do Estado de São Paulo. A Convenção das
Nações Unidas sobre Contratos de Compra e Venda Internacional de Mercadorias não se aplica. Antes de uma reclamação,
as partes tentam resolvê-la de boa-fé por pelo menos 30 dias. Fica eleito, com exclusividade, o foro da Comarca de
Campinas, Estado de São Paulo, Brasil.

## 11. Contato

Freecorps Tecnologia da Informação LTDA
Rua Cecilia Feres Zogbi, 484, Casa 20, Barão Geraldo
Campinas, SP, 13084-140, Brasil

Dúvidas, notificações legais e pedidos sobre o seu registro: [email de contato do relay].
