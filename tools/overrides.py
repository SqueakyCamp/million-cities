"""Hand-made fixes for WUP 2025 city names (keyed by the WUP City_Name).

WUP names some agglomerations after a district or a neighbouring place; the display name
here is the one people know, the WUP name stays an accepted answer.
"""

OVERRIDES = {
    'Kasaï-Oriental': dict(name='Mbuji-Mayi', aliases=['Kasai-Oriental', 'Mbujimayi'],
                           note='WUP 2025 lists this agglomeration under the province name Kasaï-Oriental.'),
    'Tamar (Hong Kong)': dict(name='Hong Kong', local=None, aliases=['Tamar', 'Victoria', 'Xianggang', 'Hongkong'],
                              note='WUP 2025 calls it "Tamar (Hong Kong)"; Tuen Mun in the New Territories is listed separately.'),
    'Coyah (Conacry)': dict(name='Conakry', local=None, aliases=['Coyah', 'Conacry', 'Konakry']),
    'Sri Jayawardenepura Kotte - Colombo': dict(name='Colombo', aliases=['Kotte', 'Sri Jayawardenepura Kotte', 'Sri Jayawardenapura Kotte']),
    'Macau - Zhuhai': dict(name='Macau – Zhuhai', aliases=['Macau', 'Macao', 'Zhuhai', 'Macau Zhuhai']),
    'Xiuying District': dict(name='Haikou', aliases=['Xiuying'], note='WUP 2025 names it after Xiuying District of Haikou.'),
    'Huaiyin District': dict(name="Huai'an", aliases=['Huaian', 'Huaiyin'], note="WUP 2025 names it after Huaiyin District of Huai'an."),
    'Tianjia‘an': dict(name='Huainan', aliases=["Tianjia'an", 'Tianjiaan'], note='WUP 2025 names it after Tianjia\'an District of Huainan.'),
    'Honghuagang': dict(name='Zunyi', aliases=['Honghuagang'], note='WUP 2025 names it after Honghuagang District of Zunyi.'),
    'Minneapolis [Saint Paul]': dict(name='Minneapolis – Saint Paul', aliases=['Minneapolis', 'Saint Paul', 'St. Paul', 'St Paul', 'Twin Cities', 'Minneapolis Saint Paul', 'Minneapolis St Paul']),
    'Al-Quds (East Jerusalem)': dict(name='East Jerusalem', local='Al-Quds', aliases=['Jerusalem', 'Al-Quds', 'Al Quds']),
    'Washington, D.C.': dict(aliases=['Washington', 'Washington DC', 'DC']),
    'Kalyan-Dombivli': dict(aliases=['Kalyan', 'Dombivli', 'Kalyan Dombivli']),
    'Binhai New Area': dict(aliases=['Binhai', 'Tanggu', 'Tianjin Binhai']),
    'Klipgat': dict(aliases=['Soshanguve', 'Ga-Rankuwa', 'Mabopane'], note='North-west of Pretoria (Soshanguve, Ga-Rankuwa, Mabopane).'),
    'Hajipur': dict(note='A large, very dense rural–urban area in the Ganges plain north of Patna (Bihar), named after Hajipur.'),
    'Ad-Dawhah (Doha)': dict(aliases=['Ad Dawhah']),
    'Sao Goncalo': dict(name='São Gonçalo'),
    'Cordoba': dict(name='Córdoba'),
    'Bhubaneshwar': dict(aliases=['Bhubaneswar']),
    'Chattogram': dict(aliases=['Chittagong']),
    'Kyiv (Kiev)': dict(name='Kyiv', local=None, aliases=['Kiev', 'Kyjiw', 'Kiew']),
    'Helsinki (Helsingfors)': dict(name='Helsinki', local='Helsingfors'),
    'New Delhi': dict(aliases=['Delhi', 'Dilli', 'Neu-Delhi']),
    'Mecca': dict(aliases=['Makkah', 'Mekka']),
    'Medina': dict(aliases=['Madinah', 'Al-Madinah']),
    'Rotterdam': dict(note='The Hague is a separate WUP city (just under 1 million).'),
    'Chhatrapati Sambhajinagar': dict(aliases=['Aurangabad'], historic=['Aurangabad']),
    'Prayagraj': dict(aliases=['Allahabad']),
    'Kozhikode': dict(aliases=['Calicut']),
    'Thiruvananthapuram': dict(aliases=['Trivandrum']),
    'Kochi': dict(aliases=['Cochin']),
    'Kollam': dict(aliases=['Quilon']),
    'Vadodara': dict(aliases=['Baroda']),
    'Varanasi': dict(aliases=['Benares', 'Banaras']),
    'Mysuru': dict(aliases=['Mysore']),
    'Bengaluru': dict(aliases=['Bangalore']),
    'Chennai': dict(aliases=['Madras']),
    'Kolkata': dict(aliases=['Calcutta', 'Kalkutta']),
    'Mumbai': dict(aliases=['Bombay']),
    'Ho Chi Minh City': dict(aliases=['Saigon', 'Ho Chi Minh', 'Ho-Chi-Minh-Stadt', 'HCMC']),
    'Yangon': dict(aliases=['Rangoon']),
    'Guangzhou': dict(aliases=['Canton', 'Kanton']),
    'Beijing': dict(aliases=['Peking']),
    'Chongqing': dict(aliases=['Chungking']),
    'Nanjing': dict(aliases=['Nanking']),
    'Xiamen City': dict(name='Xiamen', aliases=['Amoy']),
    'Batam City': dict(name='Batam'),
    'Al-Najaf': dict(name='Najaf', aliases=['An-Najaf']),
    'El Mansura': dict(name='Mansoura', aliases=['El Mansura', 'Al-Mansurah']),
    'Al Zaqaziq': dict(name='Zagazig', aliases=['Al Zaqaziq', 'Zaqaziq']),
    'Suhaj': dict(name='Sohag', aliases=['Suhaj']),
    'Kinshasa': dict(aliases=['Leopoldville']),
    'Chaozhou': dict(note='WUP 2025 splits the Chaoshan urban area (incl. Shantou) into "Chaozhou" and "Puning".'),
    'Puning': dict(note='WUP 2025 splits the Chaoshan urban area (incl. Shantou) into "Chaozhou" and "Puning".'),
    'Kutubdia': dict(note='WUP 2025 rates this population estimate as low plausibility.'),
    'Savar': dict(note='North-west of Dhaka, listed separately by WUP 2025.'),
    'Sincan': dict(note='West of Ankara, listed separately by WUP 2025.'),
    'Tuen Mun': dict(note='In Hong Kong\'s New Territories, listed separately by WUP 2025.'),
    'Oakland': dict(note='The East Bay, listed separately from San Francisco by WUP 2025.'),
    'Mesa': dict(note='East of Phoenix, listed separately by WUP 2025.'),
    'Fort Lauderdale': dict(note='North of Miami, listed separately by WUP 2025.'),
    'Tembisa': dict(note='North-east of Johannesburg, listed separately by WUP 2025.'),
    # ---- 800k–1M set
    'Shunqing': dict(name='Nanchong', aliases=['Shunqing'], note='WUP 2025 names it after Shunqing District of Nanchong.'),
    'Haizhou District': dict(name='Lianyungang', aliases=['Haizhou'], note='WUP 2025 names it after Haizhou District of Lianyungang.'),
    'Kotwali': dict(name='Bhagalpur', aliases=['Kotwali'], note='WUP 2025 lists it as "Kotwali"; it is the Bhagalpur area in Bihar.'),
    'Fushan': dict(aliases=['Yantai'], note='Fushan District of Yantai; WUP 2025 splits the Yantai urban area.'),
    'Dagupan [Lingayen]': dict(name='Dagupan', aliases=['Lingayen', 'Dagupan Lingayen']),
    'Saint Petersburg': dict(),  # Russia; the Florida one is told apart by country below
    'Kharameh': dict(note='Dense settlements east of Shiraz (Fars), listed separately by WUP 2025.'),
    'Kavar': dict(note='Dense settlements south-east of Shiraz (Fars), listed separately by WUP 2025.'),
    'Chandanaish': dict(aliases=['Satkania'], note='Between Chattogram and Cox\'s Bazar; WUP 2025 names it after Chandanaish.'),
    'Sembawang': dict(aliases=['Woodlands', 'Yishun'], note='Northern Singapore (Woodlands, Yishun, Sembawang), listed separately by WUP 2025.'),
    'Chenghai': dict(note='North-east of Shantou, listed separately by WUP 2025.'),
    'Huadu': dict(note='Northern Guangzhou, listed separately from the Guangzhou agglomeration by WUP 2025.'),
    'Bakhtiyarpur': dict(note='Dense area along the Ganges east of Patna (Bihar).'),
    'Al Mushahidah': dict(note='North of Baghdad, listed separately by WUP 2025.'),
    'Colachel': dict(note='Coastal Kanyakumari district (Tamil Nadu).'),
    'Agadir': dict(drop=['Santa Cruz', 'Santa Cruz de Aguer']),
}

# Same WUP name in two countries: (WUP name, ISO2) -> override
COUNTRY_OVERRIDES = {
    ('Saint Petersburg', 'US'): dict(name='St. Petersburg (Florida)', aliases=['St. Petersburg FL', 'St Pete', 'Saint Pete', 'Saint Petersburg Florida'],
                                     drop=['Leningrad', 'Sankt Petersburg', 'Saint Petersburg', 'St. Petersburg'],
                                     note='Pinellas County, west of Tampa. Typing "Saint Petersburg" counts the Russian city.'),
}

# keys that count every city listing them, even where one has it as its main name
ANSWER_UNION = ['Jerusalem', 'Al-Quds']

# extra answers keyed by display name (German exonyms etc. GeoNames may lack)
EXTRA_ALIASES = {
    'Moscow': ['Moskau'], 'Cairo': ['Kairo'], 'Tokyo': ['Tokio'], 'Mexico City': ['Mexiko-Stadt', 'Mexiko', 'Mexico', 'CDMX'],
    'Bangkok': ['Krung Thep'], 'Rome': ['Rom'], 'Lisbon': ['Lissabon'], 'Warsaw': ['Warschau'], 'Prague': ['Prag'],
    'Brussels': ['Brüssel'], 'Copenhagen': ['Kopenhagen'], 'Belgrade': ['Belgrad'], 'Bucharest': ['Bukarest'],
    'Athens': ['Athen'], 'Naples': ['Neapel'], 'Milan': ['Mailand'], 'Turin': ['Turin', 'Torino'], 'Munich': ['München'],
    'Cologne': ['Köln'], 'Vienna': ['Wien'], 'Algiers': ['Algier'], 'Tehran': ['Teheran'], 'Baghdad': ['Bagdad'],
    'Damascus': ['Damaskus'], 'Beirut': ['Beirut'], 'Kuwait City': ['Kuwait'], 'Riyadh': ['Riad'], 'Sana\'a': ['Sanaa'],
    'Havana': ['Havanna'], 'Kabul': ['Kabul'], 'Addis Ababa': ['Addis Abeba'], 'Mogadishu': ['Mogadischu'],
    'Khartoum': ['Khartum'], 'Tashkent': ['Taschkent'], 'Ashgabat': ['Aschgabat'], 'Pyongyang': ['Pjöngjang'],
    'Seoul': ['Söul'], 'Singapore': ['Singapur'], 'Saint Petersburg': ['St. Petersburg', 'Sankt Petersburg', 'Leningrad'],
    'New York City': ['New York', 'NYC'], 'Los Angeles': ['LA'], 'San Francisco': ['SF', 'San Francisco Bay Area'],
    'Washington, D.C.': ['Washington'], 'Kyiv': ['Kiew'], 'Nizhny Novgorod': ['Nischni Nowgorod'],
    'Yekaterinburg': ['Jekaterinburg'], 'Novosibirsk': ['Nowosibirsk'], 'Rostov-on-Don': ['Rostow am Don', 'Rostov'],
    'Kazan': ['Kasan'], 'Kharkiv': ['Charkiw', 'Kharkov'], 'Tripoli': ['Tripolis'], 'Fez': ['Fès', 'Fes'],
    'Marrakesh': ['Marrakesch', 'Marrakech'], 'Tangier': ['Tanger'], 'Casablanca': ['Dar el Beida'],
    'Abu Dhabi': ['Abu Dabi'], 'Phnom Penh': ['Phnom Penh'], 'Hanoi': ['Hanoi'], 'Taipei': ['Taipeh'],
    'Ürümqi': ['Urumqi', 'Urumchi'], "Xi'an": ['Xian', 'Sian'], 'Isfahan': ['Esfahan'], 'Mashhad': ['Maschhad'],
    'Ahwaz': ['Ahvaz'], 'Tabriz': ['Täbris'], 'Dhaka': ['Dacca', 'Dakka'], 'Kathmandu': ['Katmandu'],
    'Dushanbe': ['Duschanbe'], 'Bishkek': ['Bischkek'], 'Cape Town': ['Kapstadt'], 'Johannesburg': ['Joburg', "Jo'burg"],
    'Guatemala City': ['Guatemala', 'Guatemala-Stadt'], 'Panama City': ['Panama', 'Panama-Stadt'],
    'Kuala Lumpur': ['KL'], 'Ho Chi Minh City': ['Saigon'], 'Rio de Janeiro': ['Rio'],
}

# Fixes for the alternative databases: (db, name[, ISO2]) -> override.
# skip=True removes an entry (e.g. a Wikidata item that is a region, not a city).
ALT_OVERRIDES = {
    ('wikidata', 'Dhaka'): dict(pop=10_278_882, popyear='2022', popsrc='census 2022, Dhaka North + South City Corporations',
                                note='Wikidata lists 16.8M, which is the metropolitan figure; this is the two city corporations.'),
    ('wikidata', 'Prayagraj'): dict(pop=1_112_544, popyear='2011', popsrc='census 2011 (municipal corporation)'),
    ('wikidata', 'Hangzhou'): dict(keep=True),
    ('wikidata', 'Madrid city'): dict(name='Madrid'),
    ('wikidata', 'Aguascalientes City'): dict(name='Aguascalientes'),
    ('wikidata', 'León de Los Aldama'): dict(name='León', aliases=['León de los Aldama']),
    ('wikidata', 'Jerusalem'): dict(note='The status of Jerusalem is disputed; the figure is for the whole municipality.'),
    ('wikidata', 'Masvingo'): dict(skip=True),        # province figure
    ('wikidata', 'Garoua'): dict(skip=True),          # department figure
    ('wikidata', 'Santo Domingo', 'CL'): dict(skip=True),  # small Chilean commune, wrong figure
    # WUP 2018 uses some old names; show today's, keep the old one as an answer
    **{('wup2018', old): dict(name=new) for old, new in [
        ('Bombay', 'Mumbai'), ('Calcutta', 'Kolkata'), ('Madras', 'Chennai'), ('Bangalore', 'Bengaluru'), ('Poona', 'Pune'),
        ('Calicut', 'Kozhikode'), ('Cochin', 'Kochi'), ('Benares', 'Varanasi'), ('Allahabad', 'Prayagraj'), ('Mysore', 'Mysuru'),
        ('Kiev', 'Kyiv'), ('Chittagong', 'Chattogram'), ('Aurangabad', 'Chhatrapati Sambhajinagar'),
        ('Bruxelles-Brussel', 'Brussels'), ('Ad-Dammam', 'Dammam')]},
    ('wup2018', 'Tampa-St. Petersburg'): dict(name='Tampa – St. Petersburg', aliases=['Tampa', 'Tampa St. Petersburg'], drop=['St. Petersburg', 'Saint Petersburg']),
    ('wup2018', 'Kitakyushu-Fukuoka M.M.A.'): dict(name='Kitakyushu – Fukuoka', aliases=['Fukuoka', 'Kitakyushu']),
    ('wup2018', 'Shizuoka-Hamamatsu M.M.A.'): dict(name='Shizuoka – Hamamatsu', aliases=['Shizuoka', 'Hamamatsu']),
    # Wikidata models these as metro areas, and that is also their usual "city" figure
    ('wikidata', 'Lagos'): dict(keep=True, note='Wikidata has no separate city-proper figure for Lagos; this is Lagos as a whole.'),
    ('wikidata', 'Melbourne'): dict(keep=True, note='Australian cities are usually counted as Greater Melbourne/Sydney etc.; the City of Melbourne itself is tiny.'),
    # South African metropolitan municipalities are the cities
    ('wikidata', 'eThekwini Metropolitan'): dict(name='Durban', aliases=['eThekwini']),
    ('wikidata', 'City of Tshwane Metropolitan'): dict(name='Pretoria', aliases=['Tshwane'], note='City of Tshwane Metropolitan Municipality.'),
    ('wikidata', 'City of Ekurhuleni Metropolitan'): dict(name='Ekurhuleni', aliases=['East Rand'], note='East Rand (Germiston, Benoni, Boksburg, …).'),
    ('wikidata', 'Nelson Mandela Bay Metropolitan'): dict(name='Gqeberha', aliases=['Port Elizabeth', 'Nelson Mandela Bay'], note='Nelson Mandela Bay Metropolitan Municipality.'),
    ('wikidata', 'Kharkiv City council'): dict(skip=True),
    ('wikidata', 'Malang'): dict(pop=843_810, popyear='2020', popsrc='census 2020 (Kota Malang; Wikidata mixes in Malang Regency)'),
    ('wikidata', 'Monterrey'): dict(pop=1_142_994, popyear='2020', popsrc='census 2020 (municipality; Wikidata lists the metro figure)'),
    ('wikidata', 'Queretaro'): dict(name='Querétaro'),
    # not cities, parts of other cities, or wrong figures
    **{('wikidata', n): dict(skip=True) for n in [
        'City of Johannesburg Metropolitan', 'Moro', 'Clyde', 'Dagbon', 'Coppice', 'Southern Kyoto Prefecture',
        'Barrio Arroyo', 'Catemaco', 'Orangi', 'Gulshan Town', 'Kowloon', 'Bosaso', "Murang'a", 'Tanke', 'Banikoara',
        'Humen Town', "Chang'an Town", 'Çankaya', 'Osmangazi', 'Yopougon', 'Abobo', 'Soweto', 'Palermo', 'Taoyuan County',
        "Xiong'an New Area", 'München', 'Benito Juárez', 'Libertador', 'Municipio Iribarren', 'Stolichna', 'Kurdistan Region of Iraq',
        'North East State of Somalia', 'Pudong', 'Heroica Puebla de Zaragoza', 'Chihuahua City', 'Binhai New Area', 'Panama City', 'Kumasi', 'Quảng Ninh', 'Danzhou', 'Ikeja']},
}
