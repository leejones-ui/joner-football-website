// Lee's newsletters, newest first. Copied word for word from the Brevo campaigns
// New letters: python3 scripts/newsletter-import.py <campaignId> --apply (see that file).
// `related` = one Joner Blog that fits the letter, shown under it. Pick it by hand.

export interface LetterBlock { type: 'p' | 'h2' | 'figure' | 'cta' | 'sign' | 'ps'; html?: string; text?: string; src?: string; alt?: string; caption?: string; video?: string; label?: string; href?: string }
export interface Letter { slug: string; title: string; date: string; dateLabel: string; teaser: string; card: string; cardAlt: string; hero: LetterBlock | null; body: LetterBlock[]; brevoCampaignId?: number; related?: { slug: string; title: string; image: string } }

export const letters: Letter[] = [
  {
    "slug": "the-warehouse-i-said-i-would-never-get",
    "date": "2026-10-22",
    "dateLabel": "22 October 2026",
    "teaser": "How a swimming lesson led us to the Joner Football HQ.",
    "card": "/images/email/oct26/oct26-empty-hq-day-one.jpg",
    "cardAlt": "The empty Joner Football HQ warehouse on day one",
    "title": "The warehouse I said I would never get.",
    "hero": null,
    "body": [
      {
        "type": "p",
        "html": "This is the first photo ever taken inside our HQ in Belrose."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-empty-hq-day-one.jpg",
        "alt": "Lee and Carolina on day one in the empty HQ",
        "caption": "Day one."
      },
      {
        "type": "p",
        "html": "Carolina and me, arms in the air, in an empty unit. No pitch. No goals. Just concrete, white walls and a lot of plans."
      },
      {
        "type": "p",
        "html": "This is the story of how we got there. And it starts with a promise I made myself."
      },
      {
        "type": "h2",
        "text": "I was never getting a warehouse."
      },
      {
        "type": "p",
        "html": "I started Joner Football in 2013, and it grew faster than I ever expected."
      },
      {
        "type": "p",
        "html": "But from very early on I had one rule. No warehouse. Anyone who knows Sydney knows how expensive real estate is here. I knew that the day I took on my own facility, everything would change."
      },
      {
        "type": "p",
        "html": "So I said no. For years."
      },
      {
        "type": "p",
        "html": "Then the requests kept coming. Parents wanted afternoon training, and our programme only really ran in the mornings. Sydney has so few facilities, and even fewer with any time free. I was turning players away every week."
      },
      {
        "type": "p",
        "html": "And I hate turning players away. I want to help every player, whatever their level, whatever their ability. Saying no to them felt awful."
      },
      {
        "type": "h2",
        "text": "It started in my house."
      },
      {
        "type": "p",
        "html": "If you have followed us for a long time, you might remember this. At our old house, I built a small training area."
      },
      {
        "type": "p",
        "html": "I promised Carolina it would only be Friday afternoons. That was it."
      },
      {
        "type": "p",
        "html": "Then the players started improving. Fast. Small space, lots of touches, nowhere to hide. Parents started talking, word spread, and before long we had players coming through our house Monday to Friday. Fully booked."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-video-house.jpg",
        "alt": "Watch the first ever training session at Lee's house",
        "video": "https://www.youtube.com/watch?v=GccprC3BgCk&t=94s",
        "caption": "Watch: training at my old house"
      },
      {
        "type": "p",
        "html": "Honestly, it is one of the most successful programmes I have ever run. And it taught me something. You do not need a huge space. You need the right one."
      },
      {
        "type": "h2",
        "text": "The swimming lesson."
      },
      {
        "type": "p",
        "html": "One day, after turning away yet another player, I said to Ligia: that is it, let us start looking for a warehouse."
      },
      {
        "type": "p",
        "html": "That same day, we got an enquiry from a mum who wanted her daughter in our programme. She owned a swim school, and she offered my eldest daughter, Mia, a spot in one of her classes. So we booked Mia in."
      },
      {
        "type": "p",
        "html": "When I took Mia to her lesson, I noticed the unit right next to the swimming centre. It was up for lease."
      },
      {
        "type": "p",
        "html": "So while Mia was in the pool, I went and poked my head in."
      },
      {
        "type": "p",
        "html": "I got this feeling in my stomach straight away. This was going to be home. It is not the biggest space in the world. But if a small area in my house could develop players that fast, imagine what we could do here."
      },
      {
        "type": "p",
        "html": "We applied, and we got it straight away."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-before-stairs.jpg",
        "alt": "The HQ before the build. Bare concrete, boxes and white walls.",
        "caption": "What I saw when I poked my head in."
      },
      {
        "type": "h2",
        "text": "The day I got the keys."
      },
      {
        "type": "p",
        "html": "You can see in this video how much it meant. It was a nerve-wracking moment. Rent in Sydney is high, so this was a huge risk. It meant we had to fill it with players."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-video-keys.jpg",
        "alt": "Watch Lee get the keys to the Joner Football HQ",
        "video": "https://www.instagram.com/reel/C02oVB8P50f/"
      },
      {
        "type": "h2",
        "text": "Then the hard work started."
      },
      {
        "type": "p",
        "html": "The build was stressful. A proper pitch is expensive if you want to do it right, and I was not going to do it any other way."
      },
      {
        "type": "p",
        "html": "We turned it into a hybrid. A training facility downstairs, and an office for our content team."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-ba-turf.jpg",
        "alt": "Before and after: the turf going down, then a session on the finished pitch",
        "caption": "The turf going down. And the pitch today."
      },
      {
        "type": "h2",
        "text": "I did not do it alone."
      },
      {
        "type": "p",
        "html": "I have to say a massive thank you to my friends and family. They painted walls, put up signs, helped with the build and hung the TVs. The lot."
      },
      {
        "type": "p",
        "html": "Without them, we would never have got the HQ ready as quickly as we did. They know who they are. Thank you."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-video-sign.jpg",
        "alt": "Watch the Joner Football HQ sign go up",
        "video": "https://www.instagram.com/reel/C0yPAk5PBN3/"
      },
      {
        "type": "h2",
        "text": "The first session."
      },
      {
        "type": "p",
        "html": "I will always remember it. The turf was brand new. The place was not even finished. No logo on the wall, wires hanging from the ceiling."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-ba-logo.jpg",
        "alt": "Before and after: the Joner Football logo being painted, then the finished wall",
        "caption": "The logo going up. And the wall today."
      },
      {
        "type": "p",
        "html": "I did not care. I was so excited to get a session going in there. It was a proud moment, and a real milestone for Joner Football."
      },
      {
        "type": "p",
        "html": "And the risk paid off. Our programme nearly doubled straight away, and in that first year it was full."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-video-transformation.jpg",
        "alt": "Watch the full HQ transformation",
        "video": "https://www.instagram.com/reel/DTBYpiYkjVS/"
      },
      {
        "type": "h2",
        "text": "Why four walls work."
      },
      {
        "type": "p",
        "html": "The HQ is still small area training at heart. Four walls that close in on you. It drives the intensity of every session, and players have to think and move quicker."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-coaching.jpg",
        "alt": "Lee coaching young players at the HQ",
        "caption": "Small space, lots of touches, nowhere to hide."
      },
      {
        "type": "p",
        "html": "Since we opened, we have developed players of every age and every ability in there, using the Joner methods."
      },
      {
        "type": "p",
        "html": "And the reason we did it in the first place? We can run a session whenever we need to. 2am? No problem. No more turning players away."
      },
      {
        "type": "h2",
        "text": "The big screen."
      },
      {
        "type": "p",
        "html": "One of my favourite things in the whole HQ was a gift. One of my best mates gave us a huge projector screen. Proper cinema size."
      },
      {
        "type": "p",
        "html": "We use it to break down technique and show pro clips. I can show the players exactly how the pros do it, coach it, and then they go straight out and train it. Watch it, learn it, do it, all in the same room."
      },
      {
        "type": "p",
        "html": "And yes, it also gets used to watch the boxing with my mates."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-screen.jpg",
        "alt": "The big screen at the HQ showing pro football clips and a boxing fight",
        "caption": "Pro clips by day. Fight night by night."
      },
      {
        "type": "h2",
        "text": "The engine room."
      },
      {
        "type": "p",
        "html": "There was another big reason we needed the HQ, and most people never see it. It is upstairs."
      },
      {
        "type": "p",
        "html": "Upstairs is where our team works. Our content team has its own office, and it is where I sit down with our coaches for meetings and planning."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-coaches-meeting.jpg",
        "alt": "Lee running a coaches meeting upstairs at the HQ",
        "caption": "A coaches meeting upstairs at the HQ."
      },
      {
        "type": "p",
        "html": "Put that together with the pitch downstairs and we can film for the App really quickly. One of my favourite things is that if I have an idea for a session, I can walk downstairs and film it."
      },
      {
        "type": "p",
        "html": "It is the real engine room for the Joner Football App, and now for JF Teams too."
      },
      {
        "type": "h2",
        "text": "Where we are now."
      },
      {
        "type": "p",
        "html": "Today it is the place we call home. Somewhere our staff, our players and our parents feel comfortable."
      },
      {
        "type": "p",
        "html": "It is also our filming studio. A lot of what you see in the Joner Football App was filmed on that turf."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-belrose-today.jpg",
        "alt": "Lee outside the Joner Football HQ in Belrose today",
        "caption": "The HQ in Belrose today."
      },
      {
        "type": "h2",
        "text": "Ten years."
      },
      {
        "type": "p",
        "html": "Carolina has a room at the HQ too, where she runs her therapy practice, right next to my office. She is amazing at what she does. Sometimes we get a bit too excited in the office and she tells us to shut up."
      },
      {
        "type": "p",
        "html": "I am writing this on our 10 year wedding anniversary. She has supported me and pushed me every step of the way, and we work side by side every day. I honestly do not think I would be where I am without her. A big part of why Joner Football works is because of her."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-lee-carolina.jpg",
        "alt": "Lee and Carolina",
        "caption": "Carolina and me."
      },
      {
        "type": "h2",
        "text": "Nobody sees day one."
      },
      {
        "type": "figure",
        "src": "/images/email/oct26/oct26-hq-ba-dayone.jpg",
        "alt": "Same spot at the HQ on day one and today",
        "caption": "Same spot. Day one, and today."
      },
      {
        "type": "p",
        "html": "Almost everyone only ever sees the finished building. Nobody sees the empty unit, the stressful build or the night I decided to break my own rule."
      },
      {
        "type": "p",
        "html": "I am very grateful for how we got here. Everyone who watches our YouTube channel, trains in the App, follows us on social media or trains with us in Sydney helped build this brand. That is what let us open a facility in one of the most expensive cities in the world. Thank you."
      },
      {
        "type": "h2",
        "text": "Come and train with me."
      },
      {
        "type": "p",
        "html": "Wherever you are in the world, you can train with me inside the Joner Football App, with sessions filmed right here at the HQ."
      },
      {
        "type": "p",
        "html": "And if you are ever in Sydney, come and train with us in person."
      },
      {
        "type": "cta",
        "label": "TRAIN WITH ME IN THE APP",
        "href": "/app?utm_source=website&utm_medium=newsletter&utm_campaign=the-warehouse-i-said-i-would-never-get"
      },
      {
        "type": "cta",
        "label": "COME TRAIN AT THE HQ",
        "href": "/training?utm_source=website&utm_medium=newsletter&utm_campaign=the-warehouse-i-said-i-would-never-get"
      },
      {
        "type": "p",
        "html": "Keep turning up."
      },
      {
        "type": "sign",
        "text": "Lee"
      },
      {
        "type": "ps",
        "html": "What is the one thing you would love to see us film at the HQ next? Hit reply and tell me. I read every one."
      }
    ],
    "brevoCampaignId": 372,
    "related": {
      "slug": "improve-first-touch-football",
      "title": "How to Improve Your First Touch in Football",
      "image": "/images/homepage/audience-player.webp"
    }
  },
  {
    "slug": "every-tuesday-i-played-against-men",
    "date": "2026-09-23",
    "dateLabel": "23 September 2026",
    "teaser": "A normal week at Wrexham at sixteen, and why the off season matters.",
    "card": "/images/email/archive/archive-age-17-wrexham.jpg",
    "cardAlt": "Lee at seventeen playing for Wrexham AFC",
    "title": "Every Tuesday I played against men.",
    "hero": {
      "type": "figure",
      "src": "/images/email/archive/archive-early-years-collage.jpg",
      "alt": "The early years. Lee at Everton and Wrexham."
    },
    "body": [
      {
        "type": "p",
        "html": "I hear the same thing from parents and players every off season, and I want to be straight with you about it."
      },
      {
        "type": "p",
        "html": "<em>“He trains three times a week with his club. That is plenty.”</em>"
      },
      {
        "type": "p",
        "html": "<em>“The season is done. She has earned a rest.”</em>"
      },
      {
        "type": "p",
        "html": "I understand where it comes from. Three sessions feels like a lot when you are the one doing the driving. And a long break after a long season sounds sensible."
      },
      {
        "type": "p",
        "html": "But it is the single biggest reason players here do not get where they want to go. So let me tell you what my weeks looked like growing up, because I think it will change how you see the next few months."
      },
      {
        "type": "h2",
        "text": "Seven to twelve."
      },
      {
        "type": "p",
        "html": "I was at Everton from seven years old. From seven to twelve I trained four times a week with the club, and then a game on the weekend."
      },
      {
        "type": "figure",
        "src": "/images/email/archive/archive-age-10-everton-bellefield.jpg",
        "alt": "Age 10. Everton FC. Bellefield training ground."
      },
      {
        "type": "p",
        "html": "That was not running around and having fun. It was technical work. First touch, both feet, passing under pressure, receiving on the half turn, over and over until it was automatic. At an age when most kids here are doing one session and a game, I was doing four and a game. And I was not special in that group. Everyone there was doing it."
      },
      {
        "type": "p",
        "html": "By twelve the fundamentals were locked in. Not because I had more talent than the kids around me. Because I had done thousands more repetitions."
      },
      {
        "type": "h2",
        "text": "Sixteen. Wrexham."
      },
      {
        "type": "p",
        "html": "Then it got hard."
      },
      {
        "type": "p",
        "html": "At sixteen I signed my first youth contract, at Wrexham AFC. I want to lay out an ordinary week, because I do not think people here understand what a normal week looks like for a teenager at a professional club."
      },
      {
        "type": "figure",
        "src": "/images/email/archive/archive-age-14-wrexham.jpg",
        "alt": "Age 14. Wrexham AFC."
      },
      {
        "type": "figure",
        "src": "/images/email/archive/week-wrexham-16.png",
        "alt": "A normal week at Wrexham AFC, age sixteen. Seven sessions, two games."
      },
      {
        "type": "p",
        "html": "Count it up. Seven training sessions and two games. Not in pre season, not on a camp. That was a normal week from sixteen onwards, and it went on for years."
      },
      {
        "type": "p",
        "html": "By seventeen and eighteen the Tuesday game was every single week. Wrexham reserves, against professionals. Men who were quicker, stronger, and had been doing it for years. I had to learn fast, and the only way to keep up was to train harder in the sessions around it. There was no other option."
      },
      {
        "type": "figure",
        "src": "/images/email/archive/archive-age-17-wrexham.jpg",
        "alt": "Lee at 17 playing for Wrexham AFC."
      },
      {
        "type": "h2",
        "text": "The maths."
      },
      {
        "type": "p",
        "html": "Now put that next to three sessions a week."
      },
      {
        "type": "p",
        "html": "Seven against three is more than double, every week, for the whole year. Over a season that is hundreds of extra sessions. Over three or four years it is thousands."
      },
      {
        "type": "p",
        "html": "That is the gap. Not talent. Not coaching secrets. Not better facilities."
      },
      {
        "type": "p",
        "html": "Players in Europe are not developing faster because they are more gifted. They are developing faster because they are doing more than twice the work, and they have been doing it since they were seven."
      },
      {
        "type": "h2",
        "text": "Why Australia is behind."
      },
      {
        "type": "p",
        "html": "I have coached here for a long time now, and I think Australia is behind. I do not think it is a talent problem. I think it is a mentality problem."
      },
      {
        "type": "p",
        "html": "The belief that three times a week is enough. The belief that the off season is for switching off."
      },
      {
        "type": "p",
        "html": "Here is the thing nobody says out loud. When a player rests for the whole off season, they do not stay where they were. They go backwards. Touch goes. Sharpness goes. The habits built over the season fade. And when next season starts they are behind where they finished, while the player who kept working is ahead of where they finished."
      },
      {
        "type": "p",
        "html": "The off season here is long. That is not a reason to rest longer. That is the biggest opportunity in the whole year."
      },
      {
        "type": "h2",
        "text": "What to actually do."
      },
      {
        "type": "p",
        "html": "I am not saying a fourteen year old should copy my week at sixteen. I am saying the off season is when you fix the thing you avoided all season."
      },
      {
        "type": "p",
        "html": "Weak foot. First touch under pressure. Finishing. Speed of thought. Whatever let you down in games this year, this is the window to work on it, because nobody is watching, there is no pressure, and there is time."
      },
      {
        "type": "p",
        "html": "Pick one weakness. Work on it three or four times a week for the next few months. Turn up to pre season as a different player."
      },
      {
        "type": "p",
        "html": "That is exactly what the app is for. Structured sessions you press play on, split by age and by what you are working on, built on the same fundamentals I was drilled on from seven years old. Twenty minutes at home with a ball is a session. You do not need a pitch, a coach or a team to get better this off season. You need a plan and the willingness to do it when nobody is making you."
      },
      {
        "type": "cta",
        "label": "START THIS OFF SEASON",
        "href": "https://app.jonerfootball.com/programs/freefootballtraining?utm_source=website&utm_medium=newsletter&utm_campaign=every-tuesday-i-played-against-men"
      },
      {
        "type": "p",
        "html": "Do not rest. Work."
      },
      {
        "type": "sign",
        "text": "Lee"
      },
      {
        "type": "ps",
        "html": "If you only fix one thing this off season, make it your weak foot. It is the fastest change anyone will notice in a game."
      }
    ],
    "brevoCampaignId": 340,
    "related": {
      "slug": "football-drills-at-home",
      "title": "10 Football Drills You Can Do Alone at Home",
      "image": "/images/blog/train-at-home-lee-coaching-photo-final.jpg"
    }
  }
]
