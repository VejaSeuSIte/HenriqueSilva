"""
Build estatico do blog Henrique Silva Advocacia.
Le _posts/*.md, gera output com:
  - blog/index.html (listagem)
  - blog/<slug>/index.html (cada post)
  - blog/categoria/<cat>/index.html
  - blog/posts.json (metadata)
  - blog/rss.xml

Modos:
  python build_blog.py             -> gera em dist/ (Action / preview)
  python build_blog.py --inplace   -> gera direto em blog/ (commit no main)
"""
import os, re, json, shutil, datetime, html, argparse
from pathlib import Path
import yaml
import markdown
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parent.parent
SRC_BLOG = ROOT / 'blog'
LAYOUTS = SRC_BLOG / '_layouts'
POSTS_DIR = SRC_BLOG / '_posts'
DIST = ROOT / 'dist'
SITE_URL = 'https://vejaseusite.github.io/HenriqueSilva'

CATEGORIES = {
    'trabalhista': 'Trabalhista',
    'previdenciario': 'Previdenciário',
    'civel': 'Cível',
    'familia': 'Família',
    'consumidor': 'Consumidor',
    'imobiliario': 'Imobiliário',
    'tributario': 'Tributário',
    'criminal': 'Criminal',
    'empresarial': 'Empresarial',
    'geral': 'Geral',
}

# ===========================================================
# LANDING PAGES — uma por especialidade + sobre + contato
# Cada uma vira /<slug>/index.html, otimizada para SEO local
# ===========================================================
LANDINGS = {
    'trabalhista': {
        'slug': 'trabalhista',
        'nav': 'trabalhista',
        'related_category': 'trabalhista',
        'page_title': 'Advogado Trabalhista em Cabo de Santo Agostinho/PE · Henrique Silva Advocacia',
        'page_description': 'Especialista em Direito do Trabalho com 14 anos de prática. Execuções, horas extras, assédio moral, rescisão indireta, vínculo de emprego. Atendimento direto em Pernambuco e online.',
        'eyebrow': 'Direito Trabalhista · OAB/PE 31.742',
        'h1': 'Advogado <em>Trabalhista</em> com 14 anos de prática.',
        'subtitle': 'Causas de alta complexidade, judicial e extrajudicial. Atendimento técnico e estratégico — para empregados e empresas em todo o estado de Pernambuco.',
        'cta_text': 'Análise gratuita pelo WhatsApp',
        'wa_text': 'Olá, Dr. Henrique. Tenho uma dúvida trabalhista e gostaria de conversar.',
        'intro': {
            'h2': 'Trabalhista é a <em>frente principal</em> do escritório.',
            'paragraphs': [
                'Atuamos em <strong>todas as etapas</strong> da relação de trabalho — do contrato de admissão até a execução de sentença. Recuperamos verbas que outros advogados consideraram impossíveis, com leitura técnica de cartões-ponto, contracheques, CNIS e CTPS.',
                'Para <strong>empresas</strong>, oferecemos consultoria preventiva fixa: pareceres técnicos, análise contratual, palestras orientativas e gestão de riscos para evitar passivos. Trabalho que paga a si mesmo.',
                'A primeira análise do seu caso é <strong>gratuita pelo WhatsApp</strong>. Conte o que aconteceu — leio com calma e digo, com honestidade, se há fundamento legal para agir.',
            ],
        },
        'bullets_eye': 'Em que ajudamos',
        'bullets_h2': 'Atuação em <em>causas trabalhistas</em>.',
        'bullets': [
            {'title': 'Verbas rescisórias', 'text': 'Aviso prévio, férias, 13º, FGTS, multas e adicionais — cálculo e cobrança das verbas devidas em qualquer modalidade de rescisão.'},
            {'title': 'Horas extras', 'text': 'Análise de cartões-ponto, contracheques e prática de empresa para comprovar e cobrar horas extras não pagas, com adicional de 50% ou 100%.'},
            {'title': 'Assédio moral e sexual', 'text': 'Indenizações por dano moral em ambientes de pressão, humilhação ou conduta inadequada. Coleta criteriosa de provas testemunhais e documentais.'},
            {'title': 'Rescisão indireta', 'text': 'Quando o empregador descumpre obrigações contratuais, é possível pedir a rescisão pelas suas faltas, com mesmas verbas da dispensa sem justa causa.'},
            {'title': 'Vínculo empregatício', 'text': 'Reconhecimento da relação de emprego em situações de pejotização, contrato como autônomo ou MEI usado para mascarar vínculo CLT.'},
            {'title': 'Acidente e estabilidade', 'text': 'Acidente de trabalho, doença ocupacional, estabilidade gestante, dirigente sindical e demais hipóteses legais. Indenizações e reintegração.'},
        ],
        'faq': [
            {'q': 'Quanto tempo tenho para entrar com a ação trabalhista?', 'a': 'O prazo é de <strong>5 anos retroativos</strong> a contar da data da ação, com limite de <strong>2 anos após o fim do contrato</strong>. Se faz mais de 2 anos que você saiu da empresa, parte do direito pode estar prescrita — mas vale conferir cada caso.'},
            {'q': 'Quanto custa contratar um advogado trabalhista?', 'a': 'Em causas trabalhistas, o mais comum é o contrato <strong>por êxito</strong>: você só paga se ganhar, com percentual sobre o que receber. Sem custo inicial. Para empresas, oferecemos consultoria fixa mensal com escopo definido.'},
            {'q': 'O processo trabalhista demora muito?', 'a': 'Depende da Vara e da complexidade. Em média, <strong>6 a 18 meses</strong> até a sentença em primeira instância. Casos complexos com perícia ou muitas testemunhas podem levar mais. No início do seu caso, te passo projeção realista.'},
            {'q': 'Atende causas de outras cidades de Pernambuco?', 'a': 'Sim. Atendemos presencialmente em <strong>Cabo de Santo Agostinho</strong> e por agendamento em todo o estado. Para qualquer cidade do Brasil, atendemos <strong>100% online</strong> com a mesma qualidade — WhatsApp, videoconferência e troca de documentos por PDF.'},
            {'q': 'Posso processar uma empresa que não me registrou?', 'a': 'Sim. O <strong>vínculo empregatício</strong> pode ser reconhecido judicialmente mesmo sem CTPS assinada — basta provar pessoalidade, habitualidade, subordinação e onerosidade. Com o reconhecimento, vêm também todas as verbas devidas.'},
        ],
    },

    'previdenciario': {
        'slug': 'previdenciario',
        'nav': 'previdenciario',
        'related_category': 'previdenciario',
        'page_title': 'Advogado Previdenciário em Pernambuco · Aposentadoria, BPC e INSS · Henrique Silva',
        'page_description': 'Ações contra o INSS: aposentadorias por idade, tempo de contribuição, especial e BPC/LOAS. Auxílios por incapacidade, revisões e conversões. Atendimento em todo o estado de PE.',
        'eyebrow': 'Direito Previdenciário · INSS',
        'h1': 'Advogado <em>Previdenciário</em> · ações contra o INSS.',
        'subtitle': 'Aposentadorias, BPC/LOAS, auxílios por incapacidade e revisões. Análise criteriosa do CNIS e da contagem de tempo, do administrativo à ação judicial.',
        'cta_text': 'Análise gratuita pelo WhatsApp',
        'wa_text': 'Olá, Dr. Henrique. Tenho uma questão previdenciária (INSS) e gostaria de uma análise.',
        'intro': {
            'h2': 'O INSS nega 7 em cada 10 pedidos. <em>Nem sempre é definitivo</em>.',
            'paragraphs': [
                '<strong>Negativa do INSS não é o fim</strong>. A maioria dos benefícios concedidos hoje veio pela via judicial, com análise técnica do CNIS, comprovação de carência e prova de tempo especial ou rural.',
                'Trabalhamos com aposentadoria por idade, por tempo de contribuição, especial (insalubridade), <strong>BPC/LOAS</strong> (deficiência ou idoso de baixa renda), auxílio-doença, auxílio-acidente e pensão por morte.',
                'A análise inicial é <strong>gratuita</strong>: traga seu CNIS e a carta do INSS, e em poucos dias retorno com diagnóstico claro e estratégia.',
            ],
        },
        'bullets_eye': 'Benefícios atendidos',
        'bullets_h2': 'Atendemos os principais <em>benefícios do INSS</em>.',
        'bullets': [
            {'title': 'Aposentadorias', 'text': 'Por idade, tempo de contribuição, especial (insalubridade), professor, rural, urbana híbrida. Cálculo do tempo certo e melhor data de início.'},
            {'title': 'BPC / LOAS', 'text': 'Benefício de prestação continuada para idosos +65 e pessoas com deficiência de baixa renda. Inclui crianças e adolescentes com TEA (Lei 12.764/2012).'},
            {'title': 'Auxílio por incapacidade', 'text': 'Auxílio-doença, aposentadoria por invalidez e auxílio-acidente. Análise de laudos, perícia médica e fundamentação técnica.'},
            {'title': 'Revisões e conversões', 'text': 'Revisão da vida toda, do art. 29, conversão de tempo especial. Análise se vale a pena pedir e se há prazo.'},
            {'title': 'Pensão por morte', 'text': 'Concessão e revisão de pensões. Comprovação de dependência econômica, união estável e inclusão de filhos com deficiência.'},
            {'title': 'Tempo rural', 'text': 'Aposentadoria rural com prova testemunhal, declaração de sindicato e documentos da época. Casos sem CTPS assinada.'},
        ],
        'faq': [
            {'q': 'O INSS negou meu benefício. Posso entrar na Justiça?', 'a': 'Sim, e na maioria das vezes <strong>vale a pena</strong>. Mais de 70% dos benefícios deferidos hoje foram judicialmente. Importante: tem prazo de até <strong>10 anos</strong> para contestar o indeferimento. Mande a carta do INSS pelo WhatsApp que analisamos.'},
            {'q': 'Quanto tempo demora a aposentadoria pela Justiça?', 'a': 'De 6 a 24 meses, variando pela região e complexidade. Em casos com prova robusta, há concessão de tutela provisória — começa a receber ainda durante o processo.'},
            {'q': 'BPC para criança com autismo: como funciona?', 'a': 'A Lei 12.764/2012 equiparou o autismo (TEA) à deficiência para fins de BPC/LOAS. Crianças com TEA, independente do grau, têm direito ao benefício se a família tiver renda per capita até 1/4 do salário mínimo. Atendemos também as exceções jurisprudenciais (renda até 1/2).'},
            {'q': 'Quanto custa o advogado previdenciário?', 'a': 'Trabalhamos por <strong>êxito</strong>: você não paga nada de entrada. Os honorários são percentual sobre os atrasados que receber, definidos em contrato antes do início. Casos sem êxito não geram custo.'},
            {'q': 'Posso revisar uma aposentadoria que já recebo?', 'a': 'Sim, dentro do prazo de <strong>10 anos</strong> da concessão. Revisões da vida toda, do art. 29 e conversão de tempo especial podem aumentar o valor mensal. Antes de pedir, analisamos se vai melhorar — não vale revisar pra perder.'},
        ],
    },

    'familia': {
        'slug': 'familia',
        'nav': 'familia',
        'related_category': 'familia',
        'page_title': 'Advogado de Família em Pernambuco · Divórcio, Pensão, Guarda · Henrique Silva',
        'page_description': 'Divórcio consensual e litigioso, alimentos, partilha, guarda, regulamentação de visitas e reconhecimento de paternidade. Atendimento sensível e técnico em todo o estado de PE.',
        'eyebrow': 'Direito de Família',
        'h1': 'Direito de <em>Família</em> com sensibilidade e técnica.',
        'subtitle': 'Divórcio, alimentos, guarda, partilha, paternidade. Casos que precisam de equilíbrio emocional e rigor jurídico — conduzidos do começo ao fim com cuidado.',
        'cta_text': 'Análise gratuita pelo WhatsApp',
        'wa_text': 'Olá, Dr. Henrique. Tenho uma questão de família e gostaria de orientação.',
        'intro': {
            'h2': 'Cada caso de família esconde uma <em>história única</em>.',
            'paragraphs': [
                'Direito de Família é uma das áreas mais delicadas da advocacia. Não basta saber a lei — é preciso <strong>escutar</strong>, traduzir o que o cliente sente em pedidos juridicamente sustentáveis, e proteger interesses sem alimentar conflitos desnecessários.',
                'Atuamos em <strong>divórcio consensual e litigioso</strong>, alimentos (pedido, exoneração, revisão), guarda (compartilhada e unilateral), regulamentação de convivência, reconhecimento e investigação de paternidade, partilha e usucapião familiar.',
                'A primeira conversa é <strong>gratuita</strong> — você conta a situação, eu indico se vale a pena agir, e quais os caminhos disponíveis.',
            ],
        },
        'bullets_eye': 'O que conduzimos',
        'bullets_h2': 'Casos de <em>família</em> que atendemos.',
        'bullets': [
            {'title': 'Divórcio', 'text': 'Consensual em cartório (mais rápido e barato) ou judicial quando há litígio. Partilha, alimentos compensatórios e regulamentação de convivência junto.'},
            {'title': 'Pensão alimentícia', 'text': 'Pedido inicial, revisão (aumento ou redução), exoneração e execução de pensão atrasada — incluindo medidas como prisão civil do devedor.'},
            {'title': 'Guarda dos filhos', 'text': 'Compartilhada (regra) ou unilateral (exceção). Ações de modificação, regulamentação de visitas e enfrentamento de alienação parental.'},
            {'title': 'Partilha de bens', 'text': 'Casados, união estável e namoros qualificados. Bens adquiridos antes e durante a relação, dívidas, FGTS e previdência privada.'},
            {'title': 'Paternidade', 'text': 'Reconhecimento voluntário, investigação judicial com DNA, retificação de registro e ações de impugnação de paternidade.'},
            {'title': 'União estável', 'text': 'Reconhecimento (em vida ou post mortem) para fins patrimoniais e previdenciários. Conversão em casamento com efeitos retroativos.'},
        ],
        'faq': [
            {'q': 'Posso fazer o divórcio em cartório?', 'a': 'Sim, se for <strong>consensual</strong> (sem brigas), <strong>sem filhos menores</strong> e ambos representados por advogado. É mais rápido (uma semana) e mais barato. Quando há litígio ou filhos menores, vai pra Justiça.'},
            {'q': 'Quanto tempo demora um divórcio litigioso?', 'a': 'Em média, <strong>6 a 18 meses</strong>. Pode ser mais rápido se houver acordo ao longo do processo (a Justiça incentiva). Nas audiências de conciliação, muitos casos são resolvidos na primeira tentativa.'},
            {'q': 'A pensão alimentícia é sempre 30% do salário?', 'a': 'Não. A regra é <strong>"binômio necessidade-possibilidade"</strong>: avalia-se quanto a criança precisa e quanto o pagador pode contribuir. O percentual varia caso a caso, geralmente entre 15% e 35% dos rendimentos líquidos.'},
            {'q': 'Pai pode ter guarda compartilhada mesmo morando longe?', 'a': 'Sim. Guarda compartilhada é a regra atual e <strong>independe da distância</strong>. O que muda é a regulamentação de convivência (mais densa em períodos como férias). Decisões importantes seguem sendo conjuntas.'},
            {'q': 'Como funciona a partilha em união estável?', 'a': 'A união estável segue o <strong>regime de comunhão parcial</strong> por padrão (a menos que haja contrato escrito diferente). Bens adquiridos durante a união se dividem 50/50; bens de antes ficam com cada um.'},
        ],
    },

    'empresarial': {
        'slug': 'empresarial',
        'nav': 'empresarial',
        'related_category': 'empresarial',
        'page_title': 'Consultoria Empresarial Trabalhista em PE · Compliance e Pareceres · Henrique Silva',
        'page_description': 'Consultoria jurídica fixa para empresas: compliance trabalhista, pareceres técnicos, palestras orientativas, análise contratual e gestão de riscos. Trabalho preventivo que evita passivos.',
        'eyebrow': 'Assessoria Empresarial',
        'h1': 'Consultoria <em>empresarial</em> · compliance e prevenção.',
        'subtitle': 'Modelos de consultoria fixa para empresas. Pareceres técnicos, análise contratual, palestras orientativas e gestão de riscos trabalhistas e tributários.',
        'cta_text': 'Solicitar proposta',
        'wa_text': 'Olá, Dr. Henrique. Sou de uma empresa e gostaria de saber sobre consultoria fixa.',
        'intro': {
            'h2': 'O passivo trabalhista <em>nasce silencioso</em> e quebra a empresa.',
            'paragraphs': [
                'A maioria dos passivos trabalhistas são <strong>preveníveis</strong> com decisões pequenas tomadas no momento certo. Um contrato de freelancer mal redigido, uma jornada não controlada, uma reunião gravada de jeito errado — qualquer um vira ação trabalhista futura.',
                'Oferecemos <strong>modelos de consultoria fixa</strong> com escopo definido: análise contratual mensal, pareceres sob demanda, treinamento de gestores, auditoria de práticas e suporte estratégico em processos que já chegaram.',
                'O custo da consultoria é fração do que <strong>uma única ação trabalhista</strong> ganha. E o trabalho é silencioso — o melhor parecer é aquele que faz o problema nunca existir.',
            ],
        },
        'bullets_eye': 'Serviços para empresas',
        'bullets_h2': 'Como podemos <em>servir sua empresa</em>.',
        'bullets': [
            {'title': 'Consultoria fixa mensal', 'text': 'Pacote com horas pré-pagas para análise contratual, pareceres rápidos, suporte por WhatsApp e revisão de práticas. Custo previsível, resposta rápida.'},
            {'title': 'Pareceres técnicos', 'text': 'Análise jurídica fundamentada para decisões internas: criar cargo, contratar PJ, alterar jornada, responder notificação, encerrar contrato.'},
            {'title': 'Compliance trabalhista', 'text': 'Auditoria de práticas (jornada, comissões, equiparação, contratos), identificação de riscos e plano de adequação. Reduz passivo já no primeiro mês.'},
            {'title': 'Palestras orientativas', 'text': 'Treinamento para gestores e RH sobre boas práticas trabalhistas, reforma de 2017, novidades de jurisprudência. Gravação opcional para onboarding.'},
            {'title': 'Defesas trabalhistas', 'text': 'Atuação em processos que já chegaram. Resposta, audiência, recursos e execução. Foco em redução de risco e acordo estratégico quando possível.'},
            {'title': 'Tributário empresarial', 'text': 'Defesa em execuções fiscais, planejamento tributário, parcelamentos, exclusões da base de cálculo e repetição de indébito.'},
        ],
        'faq': [
            {'q': 'Como funciona a consultoria fixa?', 'a': 'Mensalidade definida em contrato, com <strong>pacote de horas</strong> para uso flexível: análises, pareceres, suporte por WhatsApp, reuniões. Horas excedentes têm valor à parte previamente acordado. Cliente sabe exatamente quanto vai gastar.'},
            {'q': 'Quanto custa a consultoria fixa?', 'a': 'Varia pelo porte da empresa e volume estimado. <strong>Conversamos primeiro</strong> sem compromisso para entender a realidade — quantidade de funcionários, setor, histórico de ações — e elaboramos proposta sob medida.'},
            {'q': 'Vale a pena para empresa pequena?', 'a': 'Sim, especialmente para empresas com <strong>10 a 50 funcionários</strong> que ainda não têm departamento jurídico interno. O custo da consultoria fica abaixo de uma única ação trabalhista média, e o trabalho é preventivo.'},
            {'q': 'Vocês defendem em ações já existentes?', 'a': 'Sim. Atendemos defesa de empresas em <strong>processos individuais e coletivos</strong>, em todas as instâncias trabalhistas. Cliente da consultoria fixa tem prioridade no atendimento.'},
            {'q': 'Atendem em todo o Brasil?', 'a': 'Sim. Empresas de qualquer estado podem contratar — atendimento online estruturado com videoconferências, gestão de documentos por PDF e advogados parceiros para audiências presenciais quando necessárias.'},
        ],
    },

    'imobiliario': {
        'slug': 'imobiliario',
        'nav': 'imobiliario',
        'related_category': 'imobiliario',
        'page_title': 'Advogado Imobiliário em PE · Locação, Usucapião, Compra e Venda · Henrique Silva',
        'page_description': 'Direito Imobiliário em todas as esferas: compra e venda, usucapião, regularização, locação, condomínio, distratos e ações possessórias. Atendimento técnico em Pernambuco.',
        'eyebrow': 'Direito Imobiliário',
        'h1': 'Direito <em>Imobiliário</em> · do contrato à escritura.',
        'subtitle': 'Compra e venda, usucapião, locação, condomínio e regularização. Atuação preventiva no contrato e contenciosa quando vira processo.',
        'cta_text': 'Análise gratuita pelo WhatsApp',
        'wa_text': 'Olá, Dr. Henrique. Tenho uma questão imobiliária e gostaria de orientação.',
        'intro': {
            'h2': 'Imóvel é o <em>maior patrimônio</em> da maioria das famílias.',
            'paragraphs': [
                'Comprar, vender, alugar ou regularizar um imóvel envolve riscos que não aparecem antes da assinatura. Um contrato genérico, uma matrícula com pendência, um vizinho problemático — tudo isso vira anos de litígio se não tratado no início.',
                'Atendemos a <strong>esfera judicial e extrajudicial</strong>: revisamos contratos antes de assinar, fazemos due diligence, conduzimos usucapião administrativa em cartório, ações possessórias, despejos por falta de pagamento e disputas condominiais.',
                'Cliente bem assessorado é cliente que <strong>não vira processo</strong>. E quando vira, tem o caso bem-conduzido do começo.',
            ],
        },
        'bullets_eye': 'Áreas de atuação',
        'bullets_h2': 'Casos <em>imobiliários</em> que atendemos.',
        'bullets': [
            {'title': 'Compra e venda', 'text': 'Análise de matrícula, due diligence (certidões, ônus, ITBI), revisão de contrato e acompanhamento até a escritura registrada.'},
            {'title': 'Usucapião', 'text': 'Aquisição da propriedade pela posse longa. Modalidades extraordinária, ordinária, especial urbana e rural. Procedimento administrativo (cartório) ou judicial.'},
            {'title': 'Locação', 'text': 'Contratos residenciais e comerciais, despejos por falta de pagamento ou denúncia vazia, revisional de aluguel e renovação compulsória.'},
            {'title': 'Condomínio', 'text': 'Ações de cobrança de cotas, impugnação de assembleia, conflitos com síndico, multas indevidas e disputas entre vizinhos.'},
            {'title': 'Regularização', 'text': 'Adjudicação compulsória, retificação de área, cancelamento de hipoteca quitada e regularização de imóveis em loteamentos.'},
            {'title': 'Distratos e rescisões', 'text': 'Devolução de valores em distratos de imóveis na planta, cancelamento de financiamento e ações revisionais de juros.'},
        ],
        'faq': [
            {'q': 'Vale a pena fazer due diligence antes de comprar?', 'a': 'Sim. Por uma fração do valor do imóvel, fazemos análise completa de matrícula, certidões fiscais, ônus reais e ações em curso contra o vendedor. Identificamos pendências antes da escritura — quando ainda dá para sair sem perder o sinal.'},
            {'q': 'Como funciona a usucapião?', 'a': 'É a aquisição da propriedade pelo <strong>tempo de posse mansa, pacífica e contínua</strong>. Prazos variam de 5 a 15 anos conforme a modalidade. Pode ser feita em cartório (mais rápido) ou na Justiça.'},
            {'q': 'Inquilino que não paga: como fazer despejo?', 'a': 'Ação de despejo por falta de pagamento — pode ter <strong>liminar</strong> nos primeiros 15 dias se houver caução ou seguro fiança. Sem garantia, leva mais tempo. Inclui cobrança de aluguéis vencidos e multas.'},
            {'q': 'Posso parar de pagar condomínio se o serviço é ruim?', 'a': '<strong>Não</strong>. Inadimplemento gera execução judicial. O caminho correto é assembleia para mudar a administração, ou ação para ressarcimento de prejuízos específicos. Parar de pagar agrava o problema.'},
            {'q': 'Comprei imóvel na planta, posso desistir?', 'a': 'Sim, com regras. Contratos a partir de 2018 (Lei 13.786) seguem cláusulas específicas de distrato. Em geral, recebe-se de volta entre 50% e 75% do valor pago. Em alguns casos, o juiz aumenta esse percentual.'},
        ],
    },

    'sobre': {
        'slug': 'sobre',
        'nav': 'sobre',
        'related_category': None,
        'page_title': 'Sobre · Dr. José Henrique da Silva · OAB/PE 31.742',
        'page_description': 'Conheça Dr. Henrique Silva, advogado em Pernambuco com 14 anos de atuação multidisciplinar em Direito Trabalhista, Previdenciário, Cível, Empresarial e mais.',
        'eyebrow': 'Quem Sou',
        'h1': 'Dr. <em>José Henrique da Silva</em>.',
        'subtitle': 'Advogado inscrito na OAB/PE 31.742 · 14 anos de atuação multidisciplinar em Pernambuco.',
        'cta_text': 'Falar pelo WhatsApp',
        'wa_text': 'Olá, Dr. Henrique. Vim pela página Sobre.',
        'intro': {
            'h2': 'Advocacia técnica, atenciosa e <em>direta ao ponto</em>.',
            'paragraphs': [
                '"<em>Advocacia de excelência não se mede pelo número de ações, mas pela profundidade com que cada caso é estudado e a clareza com que cada decisão é explicada ao cliente.</em>"',
                'Sou advogado inscrito na <strong>OAB/PE 31.742</strong>, com mais de 14 anos de atuação multidisciplinar no Direito brasileiro. Minha prática concentra-se em causas trabalhistas de alta complexidade, demandas previdenciárias contra o INSS, litígios cíveis, questões imobiliárias, tributárias e de Direito das Famílias — com atenção especial à condução estratégica e à mitigação de riscos.',
                'Acredito que advocacia é antes de tudo <strong>escuta técnica</strong>: ler o caso por inteiro, entender o que está em jogo, e devolver ao cliente um diagnóstico honesto antes de qualquer peça processual. Cada cliente é atendido pessoalmente, com sigilo absoluto e relatórios claros do andamento.',
            ],
        },
        'bullets_eye': 'Princípios do escritório',
        'bullets_h2': 'O que <em>orienta</em> nosso trabalho.',
        'bullets': [
            {'title': 'Atendimento direto', 'text': 'Você fala com quem cuida do seu caso. Sem intermediários, sem repassar de assessor para assessor. Comunicação por WhatsApp e videoconferência.'},
            {'title': 'Análise honesta', 'text': 'Se o caso não tem fundamento, falamos. Se tem, mas é difícil, falamos também. Promessa só vem depois de leitura técnica completa.'},
            {'title': 'Sigilo absoluto', 'text': 'Tudo que é compartilhado fica entre você e o escritório. Política de retenção mínima de dados — depois do processo encerrado, arquivamos com proteção.'},
            {'title': 'Honorários transparentes', 'text': 'Contrato escrito antes de qualquer trabalho. Sem cobrança surpresa, sem honorários ocultos. Por êxito, fixo ou misto, conforme melhor caso.'},
        ],
        'faq': [
            {'q': 'Onde você atua?', 'a': 'Presencialmente em <strong>Cabo de Santo Agostinho/PE</strong> com agendamento, e em todo o estado de Pernambuco. Para qualquer cidade do Brasil, atendimento <strong>100% online</strong> com a mesma qualidade — WhatsApp, videoconferência e troca segura de documentos.'},
            {'q': 'Há quanto tempo atua?', 'a': 'Mais de <strong>14 anos</strong> de prática contínua, desde 2010. Prática construída em todas as instâncias da Justiça do Trabalho, Justiça Federal (INSS) e Justiça Estadual (cível e família).'},
            {'q': 'Atende empresas além de pessoa física?', 'a': 'Sim. Oferecemos <strong>consultoria fixa</strong> para empresas com pacote mensal de horas, pareceres técnicos, palestras e gestão de passivos. Conheça mais na página <a href="/HenriqueSilva/empresarial/">Empresarial</a>.'},
            {'q': 'Como começamos?', 'a': 'Mande uma mensagem pelo <a href="https://wa.me/5581987134878" target="_blank">WhatsApp</a>. A primeira análise é <strong>gratuita</strong> — você conta o caso, eu retorno em até 2 horas úteis com diagnóstico claro e próximos passos.'},
        ],
    },

    'contato': {
        'slug': 'contato',
        'nav': 'contato',
        'related_category': None,
        'page_title': 'Contato · Henrique Silva Advocacia · Cabo de Santo Agostinho/PE',
        'page_description': 'Fale com o escritório Henrique Silva Advocacia. WhatsApp, e-mail e endereço em Cabo de Santo Agostinho/PE. Atendimento online em todo o Brasil.',
        'eyebrow': 'Contato',
        'h1': 'Vamos <em>conversar</em>.',
        'subtitle': 'Análise inicial gratuita pelo WhatsApp. Conte o que aconteceu — leio com calma e retorno em até 2 horas úteis.',
        'cta_text': 'WhatsApp · (81) 9 8713-4878',
        'wa_text': 'Olá, Dr. Henrique. Vim pela página de contato.',
        'intro': {
            'h2': 'Três caminhos <em>para começar</em>.',
            'paragraphs': [
                '<strong>WhatsApp</strong> · resposta mais rápida, em até 2 horas úteis. <a href="https://wa.me/5581987134878" target="_blank">(81) 9 8713-4878</a>',
                '<strong>E-mail</strong> · para envio de documentos e mensagens mais longas. <a href="mailto:henriquesilva.adv@gmail.com">henriquesilva.adv@gmail.com</a>',
                '<strong>Presencial</strong> · com agendamento prévio · Cond. Novo Mundo Empresarial · Torre 05, Sala 318 · Av. A, 4165 · Reserva do Paiva · Cabo de Santo Agostinho/PE · CEP 54522-005',
            ],
        },
        'bullets_eye': 'Como atendemos',
        'bullets_h2': 'Atendimento <em>presencial e online</em>.',
        'bullets': [
            {'title': 'Online em todo o Brasil', 'text': 'Análise inicial, reuniões e acompanhamento por WhatsApp e videoconferência. Documentos trocados por PDF com confidencialidade.'},
            {'title': 'Presencial em PE', 'text': 'Atendimento na sede em Cabo de Santo Agostinho com agendamento. Reuniões em horário comercial e, sob demanda, fora do horário.'},
            {'title': 'Análise inicial gratuita', 'text': 'A primeira conversa não tem custo. Você conta o caso, eu retorno em até 2h úteis com diagnóstico técnico e indicação de caminhos.'},
            {'title': 'Sigilo profissional', 'text': 'Tudo que é compartilhado fica entre você e o escritório, com obrigação ética de confidencialidade prevista no Estatuto da Advocacia.'},
        ],
        'faq': [
            {'q': 'Quanto tempo demora a primeira resposta?', 'a': 'Em <strong>até 2 horas úteis</strong> (segunda a sexta, 8h–19h, exceto horário de almoço). Mensagens recebidas fora desse horário são respondidas no início do próximo dia útil.'},
            {'q': 'Atendem aos sábados ou feriados?', 'a': 'Para casos urgentes, sim — mediante agendamento prévio nos canais de contato. O atendimento ordinário é de segunda a sexta.'},
            {'q': 'Posso enviar documentos pelo WhatsApp?', 'a': 'Sim, é o mais comum. Aceitamos PDF, foto e áudio. Para casos com muitos documentos, criamos um link seguro de upload (Google Drive ou similar).'},
            {'q': 'A primeira consulta tem custo?', 'a': '<strong>Não</strong>. A análise inicial — diagnóstico do seu caso e indicação de caminhos — é sempre gratuita. Você só contrata se quiser avançar, com proposta de honorários por escrito antes da assinatura.'},
        ],
    },
}

def slugify(s):
    s = s.lower()
    s = re.sub(r'[áàâãä]', 'a', s)
    s = re.sub(r'[éèêë]', 'e', s)
    s = re.sub(r'[íìîï]', 'i', s)
    s = re.sub(r'[óòôõö]', 'o', s)
    s = re.sub(r'[úùûü]', 'u', s)
    s = re.sub(r'[ç]', 'c', s)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s

def parse_post(path):
    text = path.read_text(encoding='utf-8')
    if not text.startswith('---'):
        raise ValueError(f'Post sem front-matter: {path}')
    _, fm, body = text.split('---', 2)
    meta = yaml.safe_load(fm)
    md = markdown.Markdown(extensions=['extra', 'codehilite', 'toc', 'tables', 'fenced_code', 'sane_lists', 'smarty', 'footnotes'])
    body_html = md.convert(body.strip())
    word_count = len(re.findall(r'\w+', body))
    read_min = max(1, round(word_count / 220))
    slug = meta.get('slug') or slugify(meta['title'])
    cat = meta.get('category', 'geral')
    if cat not in CATEGORIES:
        cat = 'geral'
    if isinstance(meta.get('date'), datetime.date):
        date_iso = meta['date'].isoformat()
    elif isinstance(meta.get('date'), datetime.datetime):
        date_iso = meta['date'].date().isoformat()
    else:
        date_iso = str(meta.get('date', datetime.date.today().isoformat()))
    return {
        'slug': slug,
        'title': meta['title'],
        'excerpt': meta.get('excerpt', ''),
        'category': cat,
        'category_label': CATEGORIES[cat],
        'tags': meta.get('tags', []) or [],
        'cover': meta.get('cover', ''),
        'date': date_iso,
        'updated': str(meta.get('updated', date_iso)),
        'body_html': body_html,
        'read_min': read_min,
        'word_count': word_count,
        'url': f'/HenriqueSilva/blog/{slug}/',
        'absolute_url': f'{SITE_URL}/blog/{slug}/',
    }

def fmt_date_pt(iso):
    months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
    try:
        d = datetime.date.fromisoformat(iso)
        return f'{d.day} de {months[d.month-1]} de {d.year}'
    except Exception:
        return iso

def build(inplace=False):
    if not POSTS_DIR.exists():
        print(f'WARN: {POSTS_DIR} nao existe; criando vazio')
        POSTS_DIR.mkdir(parents=True, exist_ok=True)

    posts = []
    for f in sorted(POSTS_DIR.glob('*.md')):
        try:
            posts.append(parse_post(f))
        except Exception as e:
            print(f'ERRO em {f.name}: {e}')
    posts.sort(key=lambda p: p['date'], reverse=True)

    # Setup output
    global DIST
    if inplace:
        DIST = ROOT
        # Limpa apenas arquivos gerados anteriormente em /blog/
        blog_out = DIST / 'blog'
        blog_out.mkdir(parents=True, exist_ok=True)
        for f in ['index.html', 'posts.json', 'rss.xml']:
            p = blog_out / f
            if p.exists(): p.unlink()
        if (blog_out / 'categoria').exists():
            shutil.rmtree(blog_out / 'categoria')
        # Remove subdirs de slug antigos (qualquer pasta com index.html, exceto _posts/_layouts/images)
        for sub in blog_out.iterdir():
            if sub.is_dir() and sub.name not in ('_posts', '_layouts', 'images') and (sub / 'index.html').exists():
                shutil.rmtree(sub)
    else:
        if DIST.exists():
            shutil.rmtree(DIST)
        DIST.mkdir(parents=True)
        # Copia o site principal
        for item in ['index.html', 'assets', 'admin', '.nojekyll', 'LICENSE', 'README.md']:
            src = ROOT / item
            if src.exists():
                if src.is_dir():
                    shutil.copytree(src, DIST / item)
                else:
                    shutil.copy2(src, DIST / item)
        # Copia imagens do blog
        blog_images = SRC_BLOG / 'images'
        if blog_images.exists():
            target = DIST / 'blog' / 'images'
            target.mkdir(parents=True, exist_ok=True)
            for img in blog_images.iterdir():
                if img.is_file():
                    shutil.copy2(img, target / img.name)

    # Jinja env
    env = Environment(
        loader=FileSystemLoader(str(LAYOUTS)),
        autoescape=select_autoescape(['html', 'xml']),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters['date_pt'] = fmt_date_pt

    # Render index do blog
    list_tpl = env.get_template('list.html')
    out = DIST / 'blog' / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(list_tpl.render(
        posts=posts,
        categories=CATEGORIES,
        page_title='Blog · Henrique Silva Advocacia',
        page_description='Artigos sobre Direito Trabalhista, Previdenciário, Empresarial e mais. Conteúdo prático escrito pelo Dr. José Henrique da Silva (OAB/PE 31.742).',
        canonical=f'{SITE_URL}/blog/',
        og_image=f'{SITE_URL}/assets/og-banner.jpg',
        site_url=SITE_URL,
    ), encoding='utf-8')
    print(f'Built blog/index.html with {len(posts)} posts')

    # Render cada post
    post_tpl = env.get_template('post.html')
    for i, post in enumerate(posts):
        prev_p = posts[i+1] if i+1 < len(posts) else None
        next_p = posts[i-1] if i > 0 else None
        related = [p for p in posts if p['slug'] != post['slug'] and p['category'] == post['category']][:3]
        if len(related) < 3:
            others = [p for p in posts if p['slug'] != post['slug'] and p not in related][:3-len(related)]
            related = related + others
        out = DIST / 'blog' / post['slug'] / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(post_tpl.render(
            post=post,
            prev=prev_p,
            next=next_p,
            related=related,
            page_title=f"{post['title']} · Henrique Silva Advocacia",
            page_description=post['excerpt'] or post['title'],
            canonical=post['absolute_url'],
            og_image=(SITE_URL + post['cover']) if post['cover'] else f'{SITE_URL}/assets/og-banner.jpg',
            site_url=SITE_URL,
        ), encoding='utf-8')
    print(f'Built {len(posts)} post pages')

    # Render por categoria
    if 'category.html' in os.listdir(LAYOUTS):
        cat_tpl = env.get_template('category.html')
        for cat_slug, cat_label in CATEGORIES.items():
            cat_posts = [p for p in posts if p['category'] == cat_slug]
            if not cat_posts:
                continue
            out = DIST / 'blog' / 'categoria' / cat_slug / 'index.html'
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(cat_tpl.render(
                posts=cat_posts,
                category_slug=cat_slug,
                category_label=cat_label,
                categories=CATEGORIES,
                page_title=f'{cat_label} · Blog · Henrique Silva Advocacia',
                page_description=f'Artigos sobre Direito {cat_label} no blog do Dr. José Henrique da Silva.',
                canonical=f'{SITE_URL}/blog/categoria/{cat_slug}/',
                og_image=f'{SITE_URL}/assets/og-banner.jpg',
                site_url=SITE_URL,
            ), encoding='utf-8')
        print(f'Built {len(CATEGORIES)} category pages')

    # JSON com metadata (consumido pelo admin e pela home)
    json_data = [{
        'slug': p['slug'],
        'title': p['title'],
        'excerpt': p['excerpt'],
        'category': p['category'],
        'category_label': p['category_label'],
        'tags': p['tags'],
        'cover': p['cover'],
        'date': p['date'],
        'read_min': p['read_min'],
        'url': p['url'],
    } for p in posts]
    out = DIST / 'blog' / 'posts.json'
    out.write_text(json.dumps(json_data, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Built posts.json')

    # RSS feed
    rss_items = []
    for p in posts[:20]:
        pub_dt = datetime.datetime.fromisoformat(p['date']).strftime('%a, %d %b %Y 09:00:00 -0300')
        rss_items.append(f'''  <item>
    <title>{html.escape(p['title'])}</title>
    <link>{p['absolute_url']}</link>
    <guid isPermaLink="true">{p['absolute_url']}</guid>
    <pubDate>{pub_dt}</pubDate>
    <category>{p['category_label']}</category>
    <description>{html.escape(p['excerpt'])}</description>
  </item>''')
    rss_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Henrique Silva Advocacia · Blog</title>
  <link>{SITE_URL}/blog/</link>
  <description>Artigos sobre Direito Trabalhista, Previdenciário, Empresarial e mais. Dr. José Henrique da Silva, OAB/PE 31.742.</description>
  <language>pt-br</language>
{chr(10).join(rss_items)}
</channel>
</rss>
'''
    (DIST / 'blog' / 'rss.xml').write_text(rss_xml, encoding='utf-8')
    print('Built rss.xml')

    # ============= LANDINGS por especialidade ===============
    landing_tpl = env.get_template('landing.html')
    for slug, page_data in LANDINGS.items():
        related = []
        if page_data.get('related_category'):
            related = [p for p in posts if p['category'] == page_data['related_category']][:3]
        out = DIST / slug / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(landing_tpl.render(
            page=page_data,
            related_posts=related,
            page_title=page_data['page_title'],
            page_description=page_data['page_description'],
            canonical=f"{SITE_URL}/{slug}/",
            og_image=f"{SITE_URL}/assets/og-banner.jpg",
            site_url=SITE_URL,
        ), encoding='utf-8')
    print(f'Built {len(LANDINGS)} landing pages')

    # ============= SITEMAP.XML ===============
    today = datetime.date.today().isoformat()
    urls = []
    urls.append((f'{SITE_URL}/', '1.0', today))
    for slug in LANDINGS.keys():
        urls.append((f'{SITE_URL}/{slug}/', '0.9', today))
    urls.append((f'{SITE_URL}/blog/', '0.8', today))
    for cat_slug, cat_label in CATEGORIES.items():
        cat_posts = [p for p in posts if p['category'] == cat_slug]
        if cat_posts:
            urls.append((f'{SITE_URL}/blog/categoria/{cat_slug}/', '0.7', cat_posts[0]['date']))
    for p in posts:
        urls.append((p['absolute_url'], '0.6', p['updated']))
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    for url, prio, lastmod in urls:
        sitemap += f'  <url><loc>{url}</loc><lastmod>{lastmod}</lastmod><priority>{prio}</priority></url>\n'
    sitemap += '</urlset>\n'
    (DIST / 'sitemap.xml').write_text(sitemap, encoding='utf-8')
    print(f'Built sitemap.xml with {len(urls)} URLs')

    # ============= ROBOTS.TXT ===============
    robots = f'''User-agent: *
Allow: /
Disallow: /admin/
Disallow: /blog/_posts/
Disallow: /blog/_layouts/

Sitemap: {SITE_URL}/sitemap.xml
'''
    (DIST / 'robots.txt').write_text(robots, encoding='utf-8')
    print('Built robots.txt')

    print(f'\nDone. Output: {DIST}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inplace', action='store_true', help='Escreve direto em blog/ na raiz (sem dist/)')
    args = parser.parse_args()
    build(inplace=args.inplace)
