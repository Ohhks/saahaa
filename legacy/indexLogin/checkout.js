// ================= LOAD CART DATA =================


let cartItems =
JSON.parse(localStorage.getItem("checkoutItems"));



if(!cartItems){


    cartItems =
    JSON.parse(localStorage.getItem("cart"));



}




if(!cartItems){

    cartItems=[];

}







// ================= DISPLAY ORDER =================



const orderList =
document.getElementById("order-list");



let total = 0;



cartItems.forEach((item)=>{



    total += item.price;



    let div =
    document.createElement("div");



    div.className =
    "order-item";



    div.innerHTML = `

        <h3>${item.name}</h3>

        <p>₹${item.price}</p>

    `;



    orderList.appendChild(div);



});





document.getElementById("checkout-total")
.innerText =
"₹"+total;







// ================= CONFIRM ORDER =================



const confirmButton =
document.getElementById("confirm");



confirmButton.addEventListener("click",()=>{



    let payment =
    document.querySelector(
    'input[name="payment"]:checked'
    ).parentElement.innerText;





    let order = {



        items:cartItems,


        amount:total,


        payment:payment,


        date:new Date()
        .toLocaleString()


    };






    localStorage.setItem(

        "orderHistory",

        JSON.stringify(order)

    );

    alert(

        "Order Confirmed Successfully!"

    );

    localStorage.removeItem("cart");

    localStorage.removeItem("checkoutItems");

    window.location.href =
    "booking.html";



});