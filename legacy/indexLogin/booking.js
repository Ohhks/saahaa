// ======================================
// SAHA BOOKING PAGE
// ======================================

// Current Status
let currentStep = 0;

// Timeline Steps
const steps = document.querySelectorAll(".step");

// ======================================
// ORDER TRACKING
// ======================================

function updateStatus() {

    if (currentStep < steps.length) {

        steps[currentStep].classList.add("active");

        currentStep++;

    }

}

// First status already active
currentStep = 1;

// Update every 5 seconds (Demo)
setInterval(() => {

    updateStatus();

}, 5000);

// ======================================
// STAR RATING
// ======================================

const stars = document.querySelectorAll(".stars i");

let rating = 0;

stars.forEach((star, index) => {

    star.addEventListener("click", () => {

        rating = index + 1;

        stars.forEach((item, i) => {

            if (i < rating) {

                item.classList.remove("fa-regular");
                item.classList.add("fa-solid");
                item.style.color = "#FFD700";

            } else {

                item.classList.remove("fa-solid");
                item.classList.add("fa-regular");
                item.style.color = "#ccc";

            }

        });

    });

});

// ======================================
// SUBMIT REVIEW
// ======================================

const reviewButton = document.querySelector(".submit-review");
const reviewBox = document.querySelector(".rating-card textarea");

reviewButton.addEventListener("click", () => {

    if (rating === 0) {

        alert("Please select a star rating.");

        return;

    }

    let review = reviewBox.value.trim();

    if (review === "") {

        alert("Please write your feedback.");

        return;

    }

    alert(
`Thank you!

⭐ Rating : ${rating}/5

Your review has been submitted successfully.`
    );

    reviewBox.value = "";

});

// ======================================
// SUPPORT CARDS
// ======================================

const supportCards = document.querySelectorAll(".support-card div");

supportCards[0].onclick = () => {

    alert("Calling Customer Support...");

}

supportCards[1].onclick = () => {

    alert("Opening Email...");

}

supportCards[2].onclick = () => {

    alert("Live Chat will be available soon.");

}

// ======================================
// HEADER PHONE ICON
// ======================================

const phone = document.querySelector(".fa-phone");

if (phone) {

    phone.onclick = () => {

        alert("Customer Care\n\n+91 9876543210");

    }

}

// ======================================
// SUCCESS ANIMATION
// ======================================

const successCard = document.querySelector(".success");

successCard.style.transform = "scale(.8)";
successCard.style.opacity = "0";

setTimeout(() => {

    successCard.style.transition = ".5s";
    successCard.style.transform = "scale(1)";
    successCard.style.opacity = "1";

}, 300);

// ======================================
// DETAILS CARD ANIMATION
// ======================================

const cards = document.querySelectorAll(".details-card,.rating-card,.support-card div");

cards.forEach((card, index) => {

    card.style.opacity = "0";
    card.style.transform = "translateY(25px)";

    setTimeout(() => {

        card.style.transition = ".5s";

        card.style.opacity = "1";

        card.style.transform = "translateY(0)";

    }, index * 150);

});

// ======================================
// PRINT EVENT
// ======================================

window.onbeforeprint = () => {

    alert("Preparing invoice...");

}

// ======================================
// PAGE READY
// ======================================

window.onload = () => {

    console.log("Booking Page Loaded Successfully");

};